// HST per-rij-verwerking, geëxtraheerd uit index.ts (ADR-0035 slice 0) zodat de
// orchestrator-logica testbaar is zonder het top-level `Deno.serve`.
// Gedragsneutraal: pure code-move + imports. index.ts houdt de claim-loop +
// auth-wrapper en importeert `verwerkRow` + de gedeelde interfaces.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { bouwTransportOrderPayload } from './payload-builder.ts';
import { postTransportOrder } from './hst-client.ts';
import { valideerVoorVervoerder } from '../_shared/vervoerder-eisen.ts';
import { fetchZendingColli } from '../_shared/vervoerders/fetch-zending-colli.ts';
import type { BedrijfInput, HstResponse, OrderInput, ZendingInput } from './types.ts';

export interface SendSummary {
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

export interface HstTransportOrderRow {
  id: number;
  zending_id: number;
  debiteur_nr: number | null;
  status: string;
  is_test: boolean;
}

export interface HstSecrets {
  hstBaseUrl: string;
  hstUsername: string;
  hstWachtwoord: string;
  hstCustomerId: string;
}

export async function verwerkRow(
  supabase: SupabaseClient,
  row: HstTransportOrderRow,
  secrets: HstSecrets,
  summary: SendSummary,
): Promise<void> {
  // 1. Haal context-data op uit Supabase voor de payload-builder.
  const { data: zending, error: zErr } = await supabase
    .from('zendingen')
    .select(
      'zending_nr, order_id, afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land, afl_telefoon, afl_email, totaal_gewicht_kg, aantal_colli, opmerkingen, verzenddatum',
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
  // Colli's via de Zending-colli-seam (één canonieke bron). HST gebruikt sscc +
  // gewicht + omschrijving; de extra snapshot-velden (dims/artikelnr) negeert
  // het — de payload-builder vult pallet-default-afmetingen.
  const { colli, error: colliErr } = await fetchZendingColli(supabase, row.zending_id);
  if (colliErr) {
    await markFout(supabase, row.id, `zending_colli query fout: ${colliErr}`);
    summary.failed += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: 'colli_query_fout' });
    return;
  }
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

  // Eén getypeerde view op de zending-rij — hergebruikt door zowel de payload-
  // builder als de pre-flight, zodat er maar één `as ZendingInput`-cast bestaat.
  const z = zending as ZendingInput;

  // 2. Bouw payload (pure functie).
  const payload = bouwTransportOrderPayload({
    zending: z,
    order: order as OrderInput,
    bedrijf: bedrijfRow.waarde as BedrijfInput,
    hstCustomerId: secrets.hstCustomerId,
    colli,
  });

  // Pre-flight: kies geen kansloze POST. Faalt een vervoerder-eis → direct als
  // Fout wegschrijven met heldere reden, zónder HST te bellen.
  const preflight = valideerVoorVervoerder({
    vervoerder_code: 'hst_api',
    afl_land: z.afl_land,
    afl_telefoon: z.afl_telefoon,
    afl_naam: z.afl_naam,
    afl_adres: z.afl_adres,
    afl_postcode: z.afl_postcode,
    afl_plaats: z.afl_plaats,
  });
  if (!preflight.ok) {
    const reden = 'Pre-flight: ' + preflight.problemen.map((p) => p.melding).join(' | ');
    await markFout(supabase, row.id, reden);
    summary.failed += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: 'preflight' });
    return;
  }

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

export async function markFout(
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
export async function logCarrierPayload(
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
export async function uploadPdf(
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
