// Supabase Edge Function: transus-poll
//
// Cron-driven inbox poller voor Transus M10110. Slaat inkomende berichten op in
// `edi_berichten`, parseert Karpi fixed-width ORDERS, maakt automatisch een order
// aan via de idempotente RPC `create_edi_order` en bevestigt ontvangst via M10300.
//
// Belangrijk: de raw payload wordt ALTIJD eerst durabel opgeslagen (audit-trail)
// vóór de ack. Mislukt de order-creatie (bv. geen debiteur-match op GLN), dan
// ackt de poll alsnog met status 0 — het bericht is veilig bewaard en de operator
// kan `create_edi_order` opnieuw draaien vanuit de opgeslagen payload. Zo gaat er
// nooit een order verloren door een NAK/redelivery.

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
  orders_created: number;
  empty_queue: boolean;
  details: Array<{
    transactie_id: string;
    status: 'ok' | 'parse_error' | 'unknown_type' | 'order_error';
    debiteur_nr?: number;
    order_id?: number;
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
    orders_created: 0,
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
    if (handled.order_id) result.orders_created += 1;

    await sleep(SLEEP_BETWEEN_CALLS_MS);
  }

  return jsonResp(result, 200);
});

interface HandleResult {
  transactie_id: string;
  status: 'ok' | 'parse_error' | 'unknown_type' | 'order_error';
  debiteur_nr?: number;
  order_id?: number;
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
    parsed.header.gln_afleveradres,
  );

  // Raw payload eerst durabel opslaan (audit-trail) — ongeacht of order-creatie lukt.
  const berichtId = await logInkomend(supabase, {
    p_transactie_id: transactionId,
    p_berichttype: 'order',
    p_payload_raw: payload,
    p_payload_parsed: parsed,
    p_debiteur_nr: debiteurNr,
    p_is_test: isTestMessage(parsed.header),
    p_initial_status: 'Verwerkt',
  });

  // Order automatisch aanmaken via idempotente RPC. Geen debiteur-match → niet
  // aanmaken (zou een order zonder debiteur opleveren); markeer als Fout zodat de
  // operator de GLN-mapping kan oplossen en `create_edi_order` opnieuw kan draaien.
  let orderId: number | null = null;
  let createError: string | null = null;
  if (debiteurNr === null) {
    createError = 'Geen debiteur gematcht op GLN (aflever/besteller/gefactureerd) — order niet aangemaakt';
  } else {
    try {
      orderId = await createEdiOrder(supabase, berichtId, parsed, debiteurNr);
    } catch (err) {
      createError = err instanceof Error ? err.message : String(err);
    }
  }

  if (createError) {
    await supabase
      .from('edi_berichten')
      .update({ status: 'Fout', error_msg: createError.slice(0, 250) })
      .eq('id', berichtId);
  } else if (orderId !== null) {
    await supabase.from('edi_berichten').update({ order_id: orderId }).eq('id', berichtId);
  }

  // Ack altijd met status 0: het bericht is veilig opgeslagen. Een interne
  // order-creatie-fout is geen reden om Transus te laten herleveren (zou duplicaten
  // geven; create_edi_order is idempotent maar redelivery is onnodig).
  const ackError = await confirmAndMark(supabase, creds, berichtId, transactionId, 0);
  if (ackError) {
    return {
      transactie_id: transactionId,
      status: 'parse_error',
      debiteur_nr: debiteurNr ?? undefined,
      order_id: orderId ?? undefined,
      error: ackError,
    };
  }

  if (createError) {
    return {
      transactie_id: transactionId,
      status: 'order_error',
      debiteur_nr: debiteurNr ?? undefined,
      error: createError,
    };
  }

  return {
    transactie_id: transactionId,
    status: 'ok',
    debiteur_nr: debiteurNr ?? undefined,
    order_id: orderId ?? undefined,
  };
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

async function createEdiOrder(
  supabase: ReturnType<typeof createClient>,
  berichtId: number,
  parsed: unknown,
  debiteurNr: number,
): Promise<number> {
  const { data, error } = await supabase.rpc('create_edi_order', {
    p_inkomend_bericht_id: berichtId,
    p_payload_parsed: parsed,
    p_debiteur_nr: debiteurNr,
  });
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

// Koppel een inkomende order aan een debiteur op basis van de GLN's in de header.
//
// Volgorde = meest-specifiek-eerst, zodat centraal-gefactureerde filiaalorders
// (Hornbach-patroon: gefactureerd = inactieve hoofd-AG, besteller/aflever = de
// fysieke NL-vestiging) op de juiste actieve debiteur + vestiging landen:
//   1. aflever-GLN   → afleveradressen.gln_afleveradres  (vestiging "onthouden" via bootstrap)
//   2. besteller-GLN → afleveradressen.gln_afleveradres
//   3. besteller-GLN → debiteuren.gln_bedrijf
//   4. gefactureerd-GLN → debiteuren.gln_bedrijf  (laatste redmiddel)
// Inactieve debiteuren worden bij de debiteur-lookups overgeslagen — anders zou
// Hornbach op de inactieve hoofd-debiteur (361214) belanden i.p.v. de actieve NL
// (361208). Onbekende vestiging-GLN's → null → operator koppelt handmatig via
// `koppel_edi_afleveradres` (mig 306), waarna stap 1 de volgende order auto-matcht.
async function matchDebiteur(
  supabase: ReturnType<typeof createClient>,
  glnGefactureerd: string | null,
  glnBesteller: string | null,
  glnAfleveradres: string | null,
): Promise<number | null> {
  // GLN's in de DB kunnen een trailing ".0" hebben (Excel-import-artefact);
  // match daarom tolerant op beide vormen.
  const variants = (gln: string | null): string[] => (gln ? [gln, `${gln}.0`] : []);

  // 1+2: aflever- en besteller-GLN → specifiek afleveradres
  for (const gln of [glnAfleveradres, glnBesteller]) {
    const vs = variants(gln);
    if (vs.length === 0) continue;
    const { data } = await supabase
      .from('afleveradressen')
      .select('debiteur_nr')
      .in('gln_afleveradres', vs)
      .order('debiteur_nr')
      .limit(1)
      .maybeSingle();
    if (data?.debiteur_nr) return data.debiteur_nr;
  }

  // 3+4: besteller- en gefactureerd-GLN → debiteur zelf (inactieve overslaan)
  for (const gln of [glnBesteller, glnGefactureerd]) {
    const vs = variants(gln);
    if (vs.length === 0) continue;
    const { data } = await supabase
      .from('debiteuren')
      .select('debiteur_nr')
      .in('gln_bedrijf', vs)
      .neq('status', 'Inactief')
      .order('debiteur_nr')
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
