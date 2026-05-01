// Supabase Edge Function: transus-poll
//
// Cron-driven inbox poller voor Transus M10110. Slaat inkomende berichten op in
// `edi_berichten`, parseert Karpi fixed-width ORDERS en bevestigt ontvangst via
// M10300. V1 maakt nog geen orders aan; handmatige upload doet dat apart.

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

const MAX_BATCH_PER_INVOCATION = 50;
const SLEEP_BETWEEN_CALLS_MS = 1100;

interface PollResult {
  processed: number;
  ok: number;
  errors: number;
  empty_queue: boolean;
  details: Array<{
    transactie_id: string;
    status: 'ok' | 'parse_error' | 'unknown_type';
    debiteur_nr?: number;
    error?: string;
  }>;
}

serve(async (req) => {
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

  for (let i = 0; i < MAX_BATCH_PER_INVOCATION; i++) {
    const { transactionId, message, exitCode } = await receiveMessage(creds);

    if (exitCode !== EXIT_OK) {
      if (exitCode === EXIT_RATE_LIMIT) break;
      result.details.push({
        transactie_id: transactionId ?? '',
        status: 'parse_error',
        error: `M10110 exitCode=${exitCode}: ${exitCodeMessage(exitCode)}`,
      });
      result.errors += 1;
      break;
    }

    if (transactionId === null || message === null) {
      result.empty_queue = true;
      break;
    }

    result.processed += 1;

    const handled = await handleMessage(supabase, creds, transactionId, message);
    result.details.push(handled);
    if (handled.status === 'ok') result.ok += 1;
    else result.errors += 1;

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
    const details = `Onbekend berichttype: ${berichttype}`;
    const berichtId = await logInkomend(supabase, {
      p_transactie_id: transactionId,
      p_berichttype: 'order',
      p_payload_raw: payload,
      p_payload_parsed: null,
      p_debiteur_nr: null,
      p_is_test: false,
      p_initial_status: 'Fout',
    });
    const ackError = await confirmAndMark(supabase, creds, berichtId, transactionId, 1, details);
    return {
      transactie_id: transactionId,
      status: 'unknown_type',
      error: ackError ?? `detectBerichttype=${berichttype}`,
    };
  }

  let parsed;
  try {
    parsed = parseKarpiOrder(payload);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const berichtId = await logInkomend(supabase, {
      p_transactie_id: transactionId,
      p_berichttype: 'order',
      p_payload_raw: payload,
      p_payload_parsed: null,
      p_debiteur_nr: null,
      p_is_test: false,
      p_initial_status: 'Fout',
    });
    const ackError = await confirmAndMark(supabase, creds, berichtId, transactionId, 1, errorMsg);
    return { transactie_id: transactionId, status: 'parse_error', error: ackError ?? errorMsg };
  }

  const debiteurNr = await matchDebiteur(
    supabase,
    parsed.header.gln_gefactureerd,
    parsed.header.gln_besteller,
  );

  const berichtId = await logInkomend(supabase, {
    p_transactie_id: transactionId,
    p_berichttype: 'order',
    p_payload_raw: payload,
    p_payload_parsed: parsed,
    p_debiteur_nr: debiteurNr,
    p_is_test: isTestMessage(parsed.header),
    p_initial_status: 'Verwerkt',
  });

  const ackError = await confirmAndMark(supabase, creds, berichtId, transactionId, 0);
  if (ackError) {
    return {
      transactie_id: transactionId,
      status: 'parse_error',
      debiteur_nr: debiteurNr ?? undefined,
      error: ackError,
    };
  }

  return { transactie_id: transactionId, status: 'ok', debiteur_nr: debiteurNr ?? undefined };
}

async function logInkomend(
  supabase: ReturnType<typeof createClient>,
  args: {
    p_transactie_id: string;
    p_berichttype: string;
    p_payload_raw: string;
    p_payload_parsed: unknown;
    p_debiteur_nr: number | null;
    p_is_test: boolean;
    p_initial_status: string;
  },
): Promise<number> {
  const { data, error } = await supabase.rpc('log_edi_inkomend', args);
  if (error) throw error;
  return data as number;
}

async function confirmAndMark(
  supabase: ReturnType<typeof createClient>,
  creds: TransusCredentials,
  berichtId: number,
  transactionId: string,
  status: 0 | 1 | 2,
  details = '',
): Promise<string | null> {
  const ack = await confirmMessage(creds, transactionId, status, details.slice(0, 250));
  if (ack.exitCode !== EXIT_OK) {
    const error = `M10300 exitCode=${ack.exitCode}: ${exitCodeMessage(ack.exitCode)}`;
    await supabase
      .from('edi_berichten')
      .update({ ack_status: 2, error_msg: error })
      .eq('id', berichtId);
    return error;
  }

  const { error: markErr } = await supabase.rpc('markeer_edi_ack', {
    p_id: berichtId,
    p_ack_status: status,
    p_ack_details: details || null,
  });
  if (markErr) throw markErr;
  return null;
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
