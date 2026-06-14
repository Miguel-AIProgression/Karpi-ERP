// Rhenus per-rij-verwerking, geëxtraheerd uit index.ts (ADR-0035 slice 0) zodat
// de orchestrator-logica testbaar is zonder het top-level `Deno.serve`.
// Gedragsneutraal: pure code-move + imports. Spiegelt verhoek-send/verwerk-row.ts.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { bouwRhenusBestandsnaam, bouwRhenusXml, valideerRhenusColli } from './xml-builder.ts';
import { type SftpConfig, uploadXmlViaSftp } from '../_shared/sftp-client.ts';
import { valideerVoorVervoerder } from '../_shared/vervoerder-eisen.ts';
import { fetchZendingColli } from '../_shared/vervoerders/fetch-zending-colli.ts';
import type { BedrijfInput, RhenusOpties, ZendingInput } from './types.ts';

export interface RhenusTransportOrderRow {
  id: number;
  zending_id: number;
  debiteur_nr: number | null;
  status: string;
  is_test: boolean;
  bestandsnaam: string | null;
}

export interface SendSummary {
  processed: number;
  succeeded: number;
  failed: number;
  empty_queue: boolean;
  dry_run: boolean;
  details: Array<{ id: number; zending_id: number; status: 'sent' | 'error'; bestandsnaam?: string; error?: string }>;
}

export interface VerwerkContext {
  sftpConfig: SftpConfig | null; // null in dry-run
  opties: RhenusOpties;
  dryRun: boolean;
}

export async function verwerkRow(
  supabase: SupabaseClient,
  row: RhenusTransportOrderRow,
  ctx: VerwerkContext,
  summary: SendSummary,
): Promise<void> {
  // 1. Context-data ophalen.
  const { data: zending, error: zErr } = await supabase
    .from('zendingen')
    .select('zending_nr, order_id, afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land, afl_telefoon, verzenddatum')
    .eq('id', row.zending_id)
    .single();
  if (zErr || !zending) {
    return markFoutMetSummary(supabase, row, summary, `Zending ${row.zending_id} niet gevonden: ${zErr?.message ?? 'leeg'}`);
  }

  const { data: order, error: oErr } = await supabase
    .from('orders').select('order_nr, klant_referentie').eq('id', zending.order_id).single();
  if (oErr || !order) {
    return markFoutMetSummary(supabase, row, summary, `Order ${zending.order_id} niet gevonden: ${oErr?.message ?? 'leeg'}`);
  }

  const { data: bedrijfRow, error: bErr } = await supabase
    .from('app_config').select('waarde').eq('sleutel', 'bedrijfsgegevens').single();
  if (bErr || !bedrijfRow?.waarde) {
    return markFoutMetSummary(supabase, row, summary, `bedrijfsgegevens-record ontbreekt in app_config: ${bErr?.message ?? 'leeg'}`);
  }

  // Colli's via de Zending-colli-seam: één canonieke bron, afmetingen uit de
  // bevroren zending_colli-snapshot (mig 399) — nooit meer uit een live join.
  const { colli, error: colliErr } = await fetchZendingColli(supabase, row.zending_id);
  if (colliErr) {
    return markFoutMetSummary(supabase, row, summary, `zending_colli query fout: ${colliErr}`);
  }

  const z = zending as ZendingInput & { order_id: number };

  // 2. Pre-flight: adres (gedeelde seam) + Rhenus-verplichte colli-velden.
  //    valideerRhenusColli dekt óók de 0-colli-zending — Rhenus' mapping
  //    verplicht >=1 item-segment (incident 0455395, mail 12-06-2026).
  //    Faalt iets → direct Fout met heldere reden, géén kansloze upload
  //    (ADR-0030-principe).
  const preflight = valideerVoorVervoerder({
    vervoerder_code: 'rhenus_sftp',
    afl_land: z.afl_land,
    afl_telefoon: z.afl_telefoon,
    afl_naam: z.afl_naam,
    afl_adres: z.afl_adres,
    afl_postcode: z.afl_postcode,
    afl_plaats: z.afl_plaats,
  });
  const redenen = [
    ...preflight.problemen.map((p) => p.melding),
    ...valideerRhenusColli(colli).map((p) => p.melding),
  ];
  if (redenen.length > 0) {
    return markFoutMetSummary(supabase, row, summary, 'Pre-flight: ' + redenen.join(' | '));
  }

  // 3. Bestandsnaam bepalen — eenmalig genereren en vóór de upload
  //    persisteren: een retry na een geslaagde-maar-niet-gemarkeerde upload
  //    hergebruikt dezelfde naam, zodat Rhenus geen tweede transportorder
  //    aanmaakt (zelfde dedup-aanpak als verhoek-send).
  const bestandsnaam = row.bestandsnaam ??
    bouwRhenusBestandsnaam(ctx.opties.bestandsnaam_prefix, z.zending_nr, new Date());
  if (!row.bestandsnaam) {
    const { error: naamErr } = await supabase
      .from('rhenus_transportorders')
      .update({ bestandsnaam })
      .eq('id', row.id);
    if (naamErr) {
      return markFoutMetSummary(supabase, row, summary, `bestandsnaam persisteren faalde: ${naamErr.message}`);
    }
  }

  // 3b. XML bouwen + afleveren (of dry-run).
  const xml = bouwRhenusXml({
    zending: z,
    order: { order_nr: order.order_nr, klant_referentie: order.klant_referentie ?? null },
    bedrijf: bedrijfRow.waarde as BedrijfInput,
    opties: ctx.opties,
    colli,
    nu: new Date(),
  });
  const result = ctx.dryRun
    ? { ok: true, remotePad: 'DRY_RUN — niet geüpload', errorMsg: null }
    : await uploadXmlViaSftp(ctx.sftpConfig!, bestandsnaam, xml);

  // 3c. Audit (mig 325-patroon): één externe_payloads-rij per poging,
  //     best-effort — mag het versturen nooit blokkeren.
  try {
    await supabase.rpc('log_externe_payload', {
      p_kanaal: 'rhenus',
      p_payload_raw: xml,
      p_bron: 'rhenus',
      p_externe_id: bestandsnaam,
      p_content_type: 'application/xml',
      p_headers: null,
      p_payload_json: { bestandsnaam, remote_pad: result.remotePad, ok: result.ok, dry_run: ctx.dryRun, error: result.errorMsg },
      p_richting: 'out',
      p_order_id: z.order_id ?? null,
      p_status: result.ok ? 'verwerkt' : 'fout',
      p_fout: result.ok ? null : (result.errorMsg ?? 'onbekende fout'),
    });
  } catch (e) {
    console.warn(`[rhenus-send] payload-audit faalde: ${String(e)}`);
  }

  // 4. Markeer succes/fout. Bij succes: XML-kopie naar storage (best-effort).
  if (result.ok) {
    let storagePath: string | null = null;
    try {
      const path = `rhenus-xml/${bestandsnaam}`;
      const { error: upErr } = await supabase.storage
        .from('order-documenten')
        .upload(path, new TextEncoder().encode(xml), { contentType: 'application/xml', upsert: true });
      if (!upErr) storagePath = path;
      else console.error(`[rhenus-send] storage-upload faalde: ${upErr.message}`);
    } catch (e) {
      console.error(`[rhenus-send] storage-upload exception: ${String(e)}`);
    }

    summary.succeeded += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'sent', bestandsnaam });
    const { error: markOkErr } = await supabase.rpc('markeer_rhenus_verstuurd', {
      p_id: row.id,
      p_bestandsnaam: bestandsnaam,
      p_xml_storage_path: storagePath,
      p_request_xml: xml,
    });
    if (markOkErr) console.error(`[rhenus-send] markeer_rhenus_verstuurd faalde voor rij ${row.id}: ${markOkErr.message}`);
  } else {
    summary.failed += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: result.errorMsg ?? 'onbekende fout' });
    const { error: markFoutErr } = await supabase.rpc('markeer_rhenus_fout', {
      p_id: row.id,
      p_error: result.errorMsg ?? 'onbekende fout',
      p_request_xml: xml,
      p_max_retries: 3,
    });
    if (markFoutErr) console.error(`[rhenus-send] markeer_rhenus_fout faalde voor rij ${row.id}: ${markFoutErr.message}`);
  }
}

export async function markFoutMetSummary(
  supabase: SupabaseClient,
  row: RhenusTransportOrderRow,
  summary: SendSummary,
  error: string,
): Promise<void> {
  summary.failed += 1;
  summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error });
  const { error: markErr } = await supabase.rpc('markeer_rhenus_fout', { p_id: row.id, p_error: error, p_max_retries: 3 });
  if (markErr) console.error(`[rhenus-send] markeer_rhenus_fout faalde voor rij ${row.id}: ${markErr.message}`);
}
