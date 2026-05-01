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

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { bouwTransportOrderPayload } from './payload-builder.ts';
import { postTransportOrder } from './hst-client.ts';
import type { BedrijfInput, OrderInput, ZendingInput } from './types.ts';

const MAX_PER_RUN = 25;

interface SendSummary {
  processed: number;
  succeeded: number;
  failed: number;
  empty_queue: boolean;
  details: Array<{
    id: number;
    zending_id: number;
    status: 'sent' | 'error';
    transportOrderId?: string | null;
    httpCode?: number;
    error?: string;
  }>;
}

interface HstTransportOrderRow {
  id: number;
  zending_id: number;
  debiteur_nr: number | null;
  status: string;
  is_test: boolean;
}

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

interface HstSecrets {
  hstBaseUrl: string;
  hstUsername: string;
  hstWachtwoord: string;
  hstCustomerId: string;
}

async function verwerkRow(
  supabase: SupabaseClient,
  row: HstTransportOrderRow,
  secrets: HstSecrets,
  summary: SendSummary,
): Promise<void> {
  // 1. Haal context-data op uit Supabase voor de payload-builder.
  const { data: zending, error: zErr } = await supabase
    .from('zendingen')
    .select(
      'zending_nr, order_id, afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land, ' +
        'totaal_gewicht_kg, aantal_colli, opmerkingen, verzenddatum',
    )
    .eq('id', row.zending_id)
    .single();
  if (zErr || !zending) {
    await markFout(supabase, row.id, `Zending ${row.zending_id} niet gevonden: ${zErr?.message ?? 'leeg'}`);
    summary.failed += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: 'zending_niet_gevonden' });
    return;
  }

  const { data: order, error: oErr } = await supabase
    .from('orders')
    .select('order_nr')
    .eq('id', zending.order_id)
    .single();
  if (oErr || !order) {
    await markFout(supabase, row.id, `Order ${zending.order_id} niet gevonden: ${oErr?.message ?? 'leeg'}`);
    summary.failed += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: 'order_niet_gevonden' });
    return;
  }

  const { data: bedrijfRow, error: bErr } = await supabase
    .from('app_config')
    .select('waarde')
    .eq('sleutel', 'bedrijfsgegevens')
    .single();
  if (bErr || !bedrijfRow?.waarde) {
    await markFout(supabase, row.id, `bedrijfsgegevens-record ontbreekt in app_config: ${bErr?.message ?? 'leeg'}`);
    summary.failed += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: 'bedrijfsgegevens_ontbreken' });
    return;
  }

  // 2. Bouw payload (pure functie).
  const payload = bouwTransportOrderPayload({
    zending: zending as ZendingInput,
    order: order as OrderInput,
    bedrijf: bedrijfRow.waarde as BedrijfInput,
    hstCustomerId: secrets.hstCustomerId,
  });

  // 3. POST naar HST.
  const result = await postTransportOrder({
    baseUrl: secrets.hstBaseUrl,
    username: secrets.hstUsername,
    wachtwoord: secrets.hstWachtwoord,
    payload,
  });

  // 4. Markeer succes of fout.
  if (result.ok) {
    summary.succeeded += 1;
    summary.details.push({
      id: row.id,
      zending_id: row.zending_id,
      status: 'sent',
      transportOrderId: result.transportOrderId,
      httpCode: result.httpCode,
    });
    await supabase.rpc('markeer_hst_verstuurd', {
      p_id: row.id,
      p_extern_transport_order_id: result.transportOrderId,
      p_extern_tracking_number: result.trackingNumber,
      p_request_payload: payload,
      p_response_payload: result.body,
      p_response_http_code: result.httpCode,
    });
  } else {
    summary.failed += 1;
    summary.details.push({
      id: row.id,
      zending_id: row.zending_id,
      status: 'error',
      httpCode: result.httpCode,
      error: result.errorMsg ?? 'onbekende fout',
    });
    await supabase.rpc('markeer_hst_fout', {
      p_id: row.id,
      p_error: result.errorMsg ?? 'onbekende fout',
      p_request_payload: payload,
      p_response_payload: result.body,
      p_response_http_code: result.httpCode,
      p_max_retries: 3,
    });
  }
}

async function markFout(
  supabase: SupabaseClient,
  id: number,
  error: string,
): Promise<void> {
  await supabase.rpc('markeer_hst_fout', {
    p_id: id,
    p_error: error,
    p_max_retries: 3,
  });
}

function jsonResp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
