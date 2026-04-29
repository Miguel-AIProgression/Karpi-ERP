// Supabase Edge Function: transus-poll
//
// Cron-driven inbox-leeghaler voor de Transus EDI-koppeling.
// Pollt M10110, parseert inkomende fixed-width-berichten, slaat ze op in
// `edi_berichten` en bevestigt ontvangst via M10300.
//
// READ-ONLY MODUS (V1-fase 1):
//   We slaan binnenkomende orders alleen op als audit-rij in edi_berichten —
//   we maken nog GEEN order aan in de orders-tabel. Dat houdt de validatie-loop
//   met Transus' Testen-tab schoon: parser werkt of niet, zonder side-effects.
//   Order-creatie volgt in fase 2 via een RPC `create_edi_order`.
//
// Flow per bericht:
//   1. M10110 → krijg TransactionID + base64 payload
//   2. Decodeer payload (CP-1252 → Unicode)
//   3. Detecteer berichttype (V1: alleen 'order' herkend, rest opgeslagen als 'order' met error)
//   4. Parse via karpi-fixed-width
//   5. Match BuyerGLN/InvoiceeGLN → debiteuren.gln_bedrijf
//   6. log_edi_inkomend RPC (idempotent op transactie_id)
//   7. M10300 met Status=0 (succes) of Status=1 (parse-fout)
//
// Auth: deploy met `--no-verify-jwt`. Bescherming via Supabase env-secret CRON_TOKEN
// in querystring (?token=...).
//
// Plan: docs/superpowers/plans/2026-04-29-edi-transus-koppeling.md

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  receiveMessage,
  confirmMessage,
  EXIT_OK,
  EXIT_RATE_LIMIT,
  exitCodeMessage,
  type TransusCredentials,
} from '../_shared/transus-soap.ts';
import {
  parseKarpiOrder,
  detectBerichttype,
  isTestMessage,
} from '../_shared/transus-formats/karpi-fixed-width.ts';

const MAX_BATCH_PER_INVOCATION = 50; // safety net — normaal worden er er weinig per minuut
const SLEEP_BETWEEN_CALLS_MS = 1100; // Transus throttle: min 1s

interface PollResult {
  processed: number;
  ok: number;
  errors: number;
  empty_queue: boolean;
  details: Array<{ transactie_id: string; status: 'ok' | 'parse_error' | 'unknown_type'; debiteur_nr?: number; error?: string }>;
}

serve(async (req) => {
  // Bescherming: simpele bearer-token via querystring (geen JWT op cron-endpoints)
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const expectedToken = Deno.env.get('CRON_TOKEN');
  if (!expectedToken || token !== expectedToken) {
    return new Response('Unauthorized', { status: 401 });
  }

  const creds: TransusCredentials = {
    clientId: Deno.env.get('TRANSUS_CLIENT_ID') ?? '',
    clientKey: Deno.env.get('TRANSUS_CLIENT_KEY') ?? '',
  };
  if (!creds.clientId || !creds.clientKey) {
    return jsonResp({ error: 'TRANSUS_CLIENT_ID en TRANSUS_CLIENT_KEY moeten als secrets gezet zijn' }, 500);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const result: PollResult = {
    processed: 0,
    ok: 0,
    errors: 0,
    empty_queue: false,
    details: [],
  };

  // Loop tot lege queue of MAX_BATCH bereikt
  for (let i = 0; i < MAX_BATCH_PER_INVOCATION; i++) {
    const { transactionId, message, exitCode } = await receiveMessage(creds);

    if (exitCode !== EXIT_OK) {
      if (exitCode === EXIT_RATE_LIMIT) {
        // Throttle hit; volgende invocatie pakt 'm wel
        break;
      }
      // Andere fout — log en stop
      result.details.push({
        transactie_id: transactionId ?? '',
        status: 'parse_error',
        error: `M10110 exitCode=${exitCode}: ${exitCodeMessage(exitCode)}`,
      });
      result.errors += 1;
      break;
    }

    if (transactionId === null || message === null) {
      // Lege queue
      result.empty_queue = true;
      break;
    }

    result.processed += 1;

    // Verwerk dit bericht
    const handled = await handleMessage(supabase, creds, transactionId, message);
    result.details.push(handled);
    if (handled.status === 'ok') result.ok += 1; else result.errors += 1;

    // Throttle voor volgende M10110
    await sleep(SLEEP_BETWEEN_CALLS_MS);
  }

  return jsonResp(result, 200);
});

interface HandleResult {
  transactie_id: string;
  status: 'ok' | 'parse_error' | 'unknown_type';
  debiteur_nr?: number;
  error?: string;
}

async function handleMessage(
  supabase: ReturnType<typeof createClient>,
  creds: TransusCredentials,
  transactionId: string,
  payload: string,
): Promise<HandleResult> {
  const berichttype = detectBerichttype(payload);

  if (berichttype !== 'order') {
    // Onbekend type — log raw en ack met Status=1 (delivery error) zodat Transus weet
    // dat we het niet hebben verwerkt. Status=2 (Pending) zou hetzelfde bericht
    // blijven terugsturen — we kiezen voor Status=1 om de queue te legen.
    await supabase.rpc('log_edi_inkomend', {
      p_transactie_id: transactionId,
      p_berichttype: 'order', // forceer naar 'order' om CHECK te halen — error-type opslag in error_msg
      p_payload_raw: payload,
      p_payload_parsed: null,
      p_debiteur_nr: null,
      p_is_test: false,
      p_initial_status: 'Fout',
    });
    await confirmMessage(creds, transactionId, 1, `Onbekend berichttype: ${berichttype}`);
    return { transactie_id: transactionId, status: 'unknown_type', error: `detectBerichttype=${berichttype}` };
  }

  let parsed;
  try {
    parsed = parseKarpiOrder(payload);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await supabase.rpc('log_edi_inkomend', {
      p_transactie_id: transactionId,
      p_berichttype: 'order',
      p_payload_raw: payload,
      p_payload_parsed: null,
      p_debiteur_nr: null,
      p_is_test: false,
      p_initial_status: 'Fout',
    });
    await confirmMessage(creds, transactionId, 1, errorMsg.slice(0, 250));
    return { transactie_id: transactionId, status: 'parse_error', error: errorMsg };
  }

  // Match debiteur op gln_gefactureerd (Invoicee = HQ van de partner).
  // Fallback: gln_besteller. Als beide niet matchen → debiteur_nr = null, log toch.
  const debiteurNr = await matchDebiteur(
    supabase,
    parsed.header.gln_gefactureerd,
    parsed.header.gln_besteller,
  );

  await supabase.rpc('log_edi_inkomend', {
    p_transactie_id: transactionId,
    p_berichttype: 'order',
    p_payload_raw: payload,
    p_payload_parsed: parsed,
    p_debiteur_nr: debiteurNr,
    p_is_test: isTestMessage(parsed.header),
    p_initial_status: 'Verwerkt',
  });

  // Markeer ontvangst als succesvol
  const ack = await confirmMessage(creds, transactionId, 0);
  if (ack.exitCode !== EXIT_OK) {
    return {
      transactie_id: transactionId,
      status: 'parse_error',
      debiteur_nr: debiteurNr ?? undefined,
      error: `M10300 exitCode=${ack.exitCode}: ${exitCodeMessage(ack.exitCode)}`,
    };
  }

  return { transactie_id: transactionId, status: 'ok', debiteur_nr: debiteurNr ?? undefined };
}

async function matchDebiteur(
  supabase: ReturnType<typeof createClient>,
  glnGefactureerd: string | null,
  glnBesteller: string | null,
): Promise<number | null> {
  const candidates = [glnGefactureerd, glnBesteller].filter((v): v is string => !!v);
  for (const gln of candidates) {
    const { data } = await supabase
      .from('debiteuren')
      .select('debiteur_nr')
      .eq('gln_bedrijf', gln)
      .limit(1)
      .maybeSingle();
    if (data?.debiteur_nr) return data.debiteur_nr;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
