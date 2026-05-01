// Supabase Edge Function: transus-send
//
// Cron-driven sender voor uitgaande EDI-berichten. Claimt `Wachtrij`-rijen uit
// `edi_berichten`, verstuurt de reeds gebouwde `payload_raw` via Transus M10100
// en markeert succes/fout in dezelfde tabel.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  sendMessage,
  EXIT_OK,
  EXIT_RATE_LIMIT,
  exitCodeMessage,
  type TransusCredentials,
} from '../_shared/transus-soap.ts';

const MAX_BATCH_PER_INVOCATION = 50;
const SLEEP_BETWEEN_CALLS_MS = 1100;

interface SendResult {
  processed: number;
  sent: number;
  errors: number;
  empty_queue: boolean;
  details: Array<{
    id?: number;
    berichttype?: string;
    status: 'sent' | 'error';
    transactie_id?: string;
    error?: string;
  }>;
}

interface EdiBericht {
  id: number;
  berichttype: string;
  payload_raw: string | null;
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

  const result: SendResult = {
    processed: 0,
    sent: 0,
    errors: 0,
    empty_queue: false,
    details: [],
  };

  for (let i = 0; i < MAX_BATCH_PER_INVOCATION; i++) {
    const { data: claimed, error: claimErr } = await supabase.rpc('claim_volgende_uitgaand');
    if (claimErr) throw claimErr;
    if (!claimed) {
      result.empty_queue = true;
      break;
    }

    const bericht = claimed as EdiBericht;
    result.processed += 1;

    if (!bericht.payload_raw || bericht.payload_raw.trim() === '') {
      const error = 'payload_raw ontbreekt; uitgaand bericht kan niet via M10100 worden verstuurd';
      await markeerFout(supabase, bericht.id, error);
      result.errors += 1;
      result.details.push({ id: bericht.id, berichttype: bericht.berichttype, status: 'error', error });
      continue;
    }

    const sent = await sendMessage(creds, bericht.payload_raw);
    if (sent.exitCode === EXIT_RATE_LIMIT) {
      await markeerFout(supabase, bericht.id, `M10100 exitCode=${sent.exitCode}: ${exitCodeMessage(sent.exitCode)}`, 10);
      result.errors += 1;
      result.details.push({
        id: bericht.id,
        berichttype: bericht.berichttype,
        status: 'error',
        error: `M10100 exitCode=${sent.exitCode}: ${exitCodeMessage(sent.exitCode)}`,
      });
      break;
    }

    if (sent.exitCode !== EXIT_OK || !sent.transactionId) {
      const error = `M10100 exitCode=${sent.exitCode}: ${exitCodeMessage(sent.exitCode)}`;
      await markeerFout(supabase, bericht.id, error);
      result.errors += 1;
      result.details.push({ id: bericht.id, berichttype: bericht.berichttype, status: 'error', error });
    } else {
      const { error } = await supabase.rpc('markeer_edi_verstuurd', {
        p_id: bericht.id,
        p_transactie_id: sent.transactionId,
        p_payload_raw: bericht.payload_raw,
      });
      if (error) throw error;
      result.sent += 1;
      result.details.push({
        id: bericht.id,
        berichttype: bericht.berichttype,
        status: 'sent',
        transactie_id: sent.transactionId,
      });
    }

    await sleep(SLEEP_BETWEEN_CALLS_MS);
  }

  return jsonResp(result, 200);
});

async function markeerFout(
  supabase: ReturnType<typeof createClient>,
  id: number,
  error: string,
  maxRetries = 3,
): Promise<void> {
  const { error: markErr } = await supabase.rpc('markeer_edi_fout', {
    p_id: id,
    p_error: error,
    p_max_retries: maxRetries,
  });
  if (markErr) throw markErr;
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
