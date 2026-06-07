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
import type { BedrijfInput, HstResponse, OrderInput, ZendingColliInput, ZendingInput } from './types.ts';

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

  // SSCC-colli's: één rij per fysiek pakket (mig 209). Worden bij pickronde-start
  // gegenereerd (mig 248). Zonder colli's kunnen we HST geen BarCodes meegeven —
  // dan kan HST's scanner ons label niet aan deze TransportOrder matchen. Liever
  // niet POSTen + duidelijke fout dan een onkoppelbare order bij HST.
  const { data: colliRows, error: colliErr } = await supabase
    .from('zending_colli')
    .select('colli_nr, sscc, gewicht_kg, omschrijving_snapshot')
    .eq('zending_id', row.zending_id)
    .order('colli_nr', { ascending: true });
  if (colliErr) {
    await markFout(supabase, row.id, `zending_colli query fout: ${colliErr.message}`);
    summary.failed += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: 'colli_query_fout' });
    return;
  }
  const colli = (colliRows ?? []) as ZendingColliInput[];
  if (colli.length === 0) {
    await markFout(
      supabase,
      row.id,
      `Geen zending_colli voor zending ${row.zending_id}. Pickronde moet genereer_zending_colli aanroepen vóórdat de zending op "Klaar voor verzending" gaat — anders kan HST's scanner ons label niet koppelen.`,
    );
    summary.failed += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: 'geen_colli' });
    return;
  }

  // 2. Bouw payload (pure functie).
  const payload = bouwTransportOrderPayload({
    zending: zending as ZendingInput,
    order: order as OrderInput,
    bedrijf: bedrijfRow.waarde as BedrijfInput,
    hstCustomerId: secrets.hstCustomerId,
    colli,
  });

  // 3. POST naar HST.
  const result = await postTransportOrder({
    baseUrl: secrets.hstBaseUrl,
    username: secrets.hstUsername,
    wachtwoord: secrets.hstWachtwoord,
    payload,
  });

  // 3b. Carrier-payload-audit (mig 325). Append-only: één rij per verstuur-poging,
  // zodat de volledige request/response + fout-historie bewaard blijft naast
  // hst_transportorders (dat per retry OVERSCHRIJFT). Best-effort — mag het
  // versturen nooit blokkeren.
  await logCarrierPayload(supabase, {
    orderId: (zending as { order_id?: number | null }).order_id ?? null,
    externeId: result.transportOrderId ?? (zending as { zending_nr?: string | null }).zending_nr ?? null,
    payload,
    result,
  });

  // 4. Markeer succes of fout.
  if (result.ok) {
    // 4a. Upload PDF naar storage als HST 'm meegaf (best-effort: een mislukte
    // upload mag het HST-succes niet ongedaan maken — POST is al gelukt).
    let pdfPath: string | null = null;
    let pdfUploadedAt: string | null = null;
    if (result.pdfBase64 && zending.zending_nr) {
      const path = `hst-vrachtbrieven/${zending.zending_nr}.pdf`;
      const upErr = await uploadPdf(supabase, path, result.pdfBase64);
      if (upErr) {
        console.error(`PDF-upload voor zending ${row.zending_id} faalde: ${upErr}`);
      } else {
        pdfPath = path;
        pdfUploadedAt = new Date().toISOString();
      }
    }

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
      p_pdf_path: pdfPath,
      p_pdf_uploaded_at: pdfUploadedAt,
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

// Best-effort carrier-payload-audit (mig 325) → tabel externe_payloads.
// Schrijft de letterlijke request én de (PDF-gestripte) response van één
// HST-poging weg als richting='out', gekoppeld aan order_id. Elke retry levert
// een nieuwe rij, dus de fout-historie blijft compleet — anders dan op
// hst_transportorders, dat per poging overschrijft. Logging mag het versturen
// nooit blokkeren: alles in try/catch, falen = warn + doorgaan.
async function logCarrierPayload(
  supabase: SupabaseClient,
  args: {
    orderId: number | null;
    externeId: string | null;
    payload: unknown;
    result: HstResponse;
  },
): Promise<void> {
  const { result, payload } = args;
  try {
    await supabase.rpc('log_externe_payload', {
      p_kanaal: 'hst',
      p_payload_raw: JSON.stringify(payload),
      p_bron: 'hst',
      p_externe_id: args.externeId,
      p_content_type: 'application/json',
      p_headers: null,
      p_payload_json: {
        request: payload,
        response: result.body,
        http_code: result.httpCode,
        ok: result.ok,
        transport_order_id: result.transportOrderId,
        tracking_number: result.trackingNumber,
      },
      p_richting: 'out',
      p_order_id: args.orderId,
      p_status: result.ok ? 'verwerkt' : 'fout',
      p_fout: result.ok ? null : (result.errorMsg ?? 'onbekende fout'),
    });
  } catch (e) {
    console.warn(`[hst-send] carrier-payload-audit faalde: ${String(e)}`);
  }
}

// Upload de PDF (base64-string van HST) naar de order-documenten-bucket.
// Returnt null bij succes of een error-message-string bij falen. Bewust geen
// throw — een PDF-upload-fout mag het HST-succes niet ongedaan maken.
async function uploadPdf(
  supabase: SupabaseClient,
  path: string,
  base64: string,
): Promise<string | null> {
  try {
    const bytes = base64ToBytes(base64);
    const { error } = await supabase.storage
      .from('order-documenten')
      .upload(path, bytes, {
        contentType: 'application/pdf',
        upsert: true, // overschrijf bij retry / heruitvoer
      });
    return error ? error.message : null;
  } catch (err) {
    return `decode/upload-exception: ${String(err)}`;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function jsonResp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
