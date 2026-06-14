// Supabase Edge Function: hst-send
//
// Cron-driven sender voor HST TransportOrders. Claimt 'Wachtrij'-rijen uit
// `hst_transportorders` (HST-adapter-tabel), bouwt een TransportOrder-payload
// uit zending + order + bedrijfsgegevens, POST't via Basic-auth naar HST en
// markeert succes/fout in dezelfde tabel.
//
// Auth: Bearer-CRON_TOKEN-header (zelfde patroon als transus-send).
// Verticale slice: alle HST-specifieke logica leeft in deze folder. Switch
// naar HST gebeurt in plpgsql (`enqueue_zending_naar_vervoerder` in mig 172).
//
// Plan: docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md (Task 2.4)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { capabilityVoor } from '../_shared/vervoerders/capabilities.ts';
import {
  type HstSecrets,
  type HstTransportOrderRow,
  type SendSummary,
  verwerkRow,
} from './verwerk-row.ts';

const MAX_PER_RUN = capabilityVoor('hst_api')?.maxPerRun ?? 25;

Deno.serve(async (req) => {
  const expectedToken = Deno.env.get('CRON_TOKEN');
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return jsonResp({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const hstBaseUrl = Deno.env.get('HST_API_BASE_URL');
  const hstUsername = Deno.env.get('HST_API_USERNAME');
  const hstWachtwoord = Deno.env.get('HST_API_WACHTWOORD');
  const hstCustomerId = Deno.env.get('HST_API_CUSTOMER_ID');

  if (!supabaseUrl || !serviceKey) {
    return jsonResp({ error: 'SUPABASE_URL / SERVICE_ROLE_KEY ontbreken' }, 500);
  }
  if (!hstBaseUrl || !hstUsername || !hstWachtwoord || !hstCustomerId) {
    return jsonResp({
      error: 'HST_API_BASE_URL / USERNAME / WACHTWOORD / CUSTOMER_ID moeten als secrets gezet zijn',
    }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Zelfhelend: herstel rijen die in een vorige run vastliepen in 'Bezig'
  // (crash/timeout vóór markeer-*). Best-effort — mag de run niet blokkeren.
  try {
    const { data: hersteld } = await supabase.rpc('herstel_vastgelopen_hst', { p_minuten: 10 });
    if (hersteld && Number(hersteld) > 0) {
      console.log(`[hst-send] reaper: ${hersteld} vastgelopen Bezig-rij(en) teruggezet naar Wachtrij`);
    }
  } catch (e) {
    console.warn(`[hst-send] reaper faalde: ${String(e)}`);
  }

  const summary: SendSummary = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    empty_queue: false,
    details: [],
  };

  for (let i = 0; i < MAX_PER_RUN; i++) {
    const { data: claimed, error: claimErr } = await supabase
      .rpc('claim_volgende_hst_transportorder');
    if (claimErr) {
      return jsonResp({ error: `claim-rpc fout: ${claimErr.message}` }, 500);
    }
    const row = claimed as HstTransportOrderRow | null;
    if (!row || !row.id) {
      summary.empty_queue = true;
      break;
    }
    summary.processed += 1;

    try {
      await verwerkRow(supabase, row, {
        hstBaseUrl,
        hstUsername,
        hstWachtwoord,
        hstCustomerId,
      }, summary);
    } catch (err) {
      summary.failed += 1;
      summary.details.push({
        id: row.id,
        zending_id: row.zending_id,
        status: 'error',
        error: String(err),
      });
      await supabase.rpc('markeer_hst_fout', {
        p_id: row.id,
        p_error: `Onverwachte exception: ${String(err)}`,
        p_max_retries: 3,
      });
    }
  }

  return jsonResp(summary, 200);
});

function jsonResp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
