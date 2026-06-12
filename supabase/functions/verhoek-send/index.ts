// Supabase Edge Function: verhoek-send
//
// Cron-driven sender voor Verhoek-XML's (ADR-0031). Claimt 'Wachtrij'-rijen
// uit `verhoek_transportorders`, bouwt per zending een AA2.0-XML en levert
// die via SFTP aan bij Verhoek. Audit: externe_payloads (kanaal 'verhoek',
// elke poging een rij) + XML-kopie in storage (order-documenten/verhoek-xml/).
//
// DRY-RUN (secret VERHOEK_DRY_RUN, default 'true'): hele keten draait —
// XML, preflight, storage, audit, markeer — maar de SFTP-upload wordt
// overgeslagen. Go-live = VERHOEK_DRY_RUN=false + SFTP-secrets + config.
//
// Auth: Bearer-CRON_TOKEN-header (zelfde patroon als hst-send).
// Plan: docs/superpowers/plans/2026-06-11-verhoek-transporteur-xml-sftp.md

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { bouwVerhoekBestandsnaam, bouwVerhoekXml, valideerVerhoekColli } from './xml-builder.ts';
import { type SftpConfig, uploadXmlViaSftp } from '../_shared/sftp-client.ts';
import { valideerVoorVervoerder } from '../_shared/vervoerder-eisen.ts';
import { DEFAULT_VERHOEK_OPTIES } from './types.ts';
import type { BedrijfInput, VerhoekColliInput, VerhoekOpties, ZendingInput } from './types.ts';

const MAX_PER_RUN = 25;

interface VerhoekTransportOrderRow {
  id: number;
  zending_id: number;
  debiteur_nr: number | null;
  status: string;
  is_test: boolean;
  bestandsnaam: string | null;
}

interface SendSummary {
  processed: number;
  succeeded: number;
  failed: number;
  empty_queue: boolean;
  dry_run: boolean;
  details: Array<{ id: number; zending_id: number; status: 'sent' | 'error'; bestandsnaam?: string; error?: string }>;
}

Deno.serve(async (req) => {
  const expectedToken = Deno.env.get('CRON_TOKEN');
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return jsonResp({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResp({ error: 'SUPABASE_URL / SERVICE_ROLE_KEY ontbreken' }, 500);
  }

  // Dry-run default AAN: zonder expliciete VERHOEK_DRY_RUN=false gaat er
  // niets de deur uit. Veilige standaard tot de go-live-checklist (Fase 2).
  const dryRun = (Deno.env.get('VERHOEK_DRY_RUN') ?? 'true').toLowerCase() !== 'false';

  let sftpConfig: SftpConfig | null = null;
  if (!dryRun) {
    const host = Deno.env.get('VERHOEK_SFTP_HOST');
    const user = Deno.env.get('VERHOEK_SFTP_USER');
    const password = Deno.env.get('VERHOEK_SFTP_PASSWORD');
    if (!host || !user || !password) {
      return jsonResp({ error: 'VERHOEK_DRY_RUN=false maar VERHOEK_SFTP_HOST / USER / PASSWORD ontbreken' }, 500);
    }
    sftpConfig = {
      host,
      port: Number(Deno.env.get('VERHOEK_SFTP_PORT') ?? '22'),
      username: user,
      password,
      remoteDir: Deno.env.get('VERHOEK_SFTP_REMOTE_DIR') ?? '/',
    };
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Runtime-config (mig 374): antwoorden van Verhoek landen hier — per run
  // gelezen, dus een config-UPDATE werkt zonder redeploy.
  const { data: cfgRow } = await supabase
    .from('app_config').select('waarde').eq('sleutel', 'verhoek').single();
  const opties: VerhoekOpties = { ...DEFAULT_VERHOEK_OPTIES, ...((cfgRow?.waarde ?? {}) as Partial<VerhoekOpties>) };

  // Zelfhelend (mig 375-reaper): herstel rijen die vastliepen in 'Bezig'.
  try {
    const { data: hersteld } = await supabase.rpc('herstel_vastgelopen_verhoek', { p_minuten: 10 });
    if (hersteld && Number(hersteld) > 0) {
      console.log(`[verhoek-send] reaper: ${hersteld} vastgelopen Bezig-rij(en) terug naar Wachtrij`);
    }
  } catch (e) {
    console.warn(`[verhoek-send] reaper faalde: ${String(e)}`);
  }

  const summary: SendSummary = { processed: 0, succeeded: 0, failed: 0, empty_queue: false, dry_run: dryRun, details: [] };

  const runStart = Date.now();
  for (let i = 0; i < MAX_PER_RUN; i++) {
    // Tijdsbudget (review-I2): ruim binnen de edge-wall-clock blijven; de
    // rest van de wachtrij pakt de volgende cron-run (elke minuut) op.
    if (Date.now() - runStart > 60_000) break;
    const { data: claimed, error: claimErr } = await supabase.rpc('claim_volgende_verhoek_transportorder');
    if (claimErr) return jsonResp({ error: `claim-rpc fout: ${claimErr.message}` }, 500);
    const row = claimed as VerhoekTransportOrderRow | null;
    if (!row || !row.id) {
      summary.empty_queue = true;
      break;
    }
    summary.processed += 1;

    try {
      await verwerkRow(supabase, row, { sftpConfig, opties, dryRun }, summary);
    } catch (err) {
      summary.failed += 1;
      summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: String(err) });
      const { error: catchMarkErr } = await supabase.rpc('markeer_verhoek_fout', { p_id: row.id, p_error: `Onverwachte exception: ${String(err)}`, p_max_retries: 3 });
      if (catchMarkErr) console.error(`[verhoek-send] markeer_verhoek_fout faalde voor rij ${row.id}: ${catchMarkErr.message}`);
    }
  }

  return jsonResp(summary, 200);
});

interface VerwerkContext {
  sftpConfig: SftpConfig | null; // null in dry-run
  opties: VerhoekOpties;
  dryRun: boolean;
}

async function verwerkRow(
  supabase: SupabaseClient,
  row: VerhoekTransportOrderRow,
  ctx: VerwerkContext,
  summary: SendSummary,
): Promise<void> {
  // 1. Context-data ophalen.
  const { data: zending, error: zErr } = await supabase
    .from('zendingen')
    .select('zending_nr, order_id, afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land, afl_telefoon, afl_email, opmerkingen, verzenddatum')
    .eq('id', row.zending_id)
    .single();
  if (zErr || !zending) {
    return markFoutMetSummary(supabase, row, summary, `Zending ${row.zending_id} niet gevonden: ${zErr?.message ?? 'leeg'}`);
  }

  const { data: order, error: oErr } = await supabase
    .from('orders').select('order_nr').eq('id', zending.order_id).single();
  if (oErr || !order) {
    return markFoutMetSummary(supabase, row, summary, `Order ${zending.order_id} niet gevonden: ${oErr?.message ?? 'leeg'}`);
  }

  const { data: bedrijfRow, error: bErr } = await supabase
    .from('app_config').select('waarde').eq('sleutel', 'bedrijfsgegevens').single();
  if (bErr || !bedrijfRow?.waarde) {
    return markFoutMetSummary(supabase, row, summary, `bedrijfsgegevens-record ontbreekt in app_config: ${bErr?.message ?? 'leeg'}`);
  }

  // Colli's mét afmetingen: maatwerk-dims van de orderregel, anders product-dims.
  const { data: colliRows, error: colliErr } = await supabase
    .from('zending_colli')
    .select('colli_nr, sscc, gewicht_kg, omschrijving_snapshot, order_regels:order_regel_id ( artikelnr, maatwerk_lengte_cm, maatwerk_breedte_cm, producten:order_regels_artikelnr_fkey ( lengte_cm, breedte_cm ) )')
    .eq('zending_id', row.zending_id)
    .order('colli_nr', { ascending: true });
  if (colliErr) {
    return markFoutMetSummary(supabase, row, summary, `zending_colli query fout: ${colliErr.message}`);
  }
  // deno-lint-ignore no-explicit-any
  const colli: VerhoekColliInput[] = ((colliRows ?? []) as any[]).map((r) => ({
    colli_nr: r.colli_nr,
    sscc: r.sscc,
    gewicht_kg: r.gewicht_kg,
    omschrijving_snapshot: r.omschrijving_snapshot,
    artikelnr: r.order_regels?.artikelnr ?? null,
    lengte_cm: r.order_regels?.maatwerk_lengte_cm ?? r.order_regels?.producten?.lengte_cm ?? null,
    breedte_cm: r.order_regels?.maatwerk_breedte_cm ?? r.order_regels?.producten?.breedte_cm ?? null,
  }));
  if (colli.length === 0) {
    return markFoutMetSummary(
      supabase, row, summary,
      `Geen zending_colli voor zending ${row.zending_id}. Pickronde moet genereer_zending_colli aanroepen — zonder ScanCode kan Verhoek ons label niet matchen.`,
    );
  }

  const z = zending as ZendingInput & { order_id: number };

  // 2. Pre-flight: adres (gedeelde seam) + Verhoek-verplichte colli-velden +
  //    go-live-guard. Faalt iets → direct Fout met heldere reden, géén
  //    kansloze upload (ADR-0030-principe).
  const preflight = valideerVoorVervoerder({
    vervoerder_code: 'verhoek_sftp',
    afl_land: z.afl_land,
    afl_telefoon: z.afl_telefoon,
    afl_naam: z.afl_naam,
    afl_adres: z.afl_adres,
    afl_postcode: z.afl_postcode,
    afl_plaats: z.afl_plaats,
  });
  const colliProblemen = valideerVerhoekColli(colli);
  const redenen = [
    ...preflight.problemen.map((p) => p.melding),
    ...colliProblemen.map((p) => p.melding),
  ];
  // Echte verzending vereist een bevestigd opdrachtgevernummer (vraag 1
  // testmail). In dry-run mag het leeg blijven (lege tag, zoals testbestand).
  if (!ctx.dryRun && ctx.opties.opdrachtgever_nummer.trim() === '') {
    redenen.push("opdrachtgever_nummer ontbreekt in app_config 'verhoek' — antwoord Verhoek (vraag 1) nog niet verwerkt.");
  }
  if (redenen.length > 0) {
    return markFoutMetSummary(supabase, row, summary, 'Pre-flight: ' + redenen.join(' | '));
  }

  // 3. Bestandsnaam bepalen — Verhoeks dedup-sleutel (DataEntry verwerkt per
  //    bestand). Eenmalig genereren en vóór de upload persisteren: een retry
  //    na een geslaagde-maar-niet-gemarkeerde upload hergebruikt dezelfde
  //    naam, zodat Verhoek geen tweede transportorder aanmaakt (review-I1).
  const bestandsnaam = row.bestandsnaam ?? bouwVerhoekBestandsnaam(z.zending_nr, new Date());
  if (!row.bestandsnaam) {
    const { error: naamErr } = await supabase
      .from('verhoek_transportorders')
      .update({ bestandsnaam })
      .eq('id', row.id);
    if (naamErr) {
      return markFoutMetSummary(supabase, row, summary, `bestandsnaam persisteren faalde: ${naamErr.message}`);
    }
  }

  // 3b. XML bouwen + afleveren (of dry-run).
  const xml = bouwVerhoekXml({
    zending: z,
    order: { order_nr: order.order_nr },
    bedrijf: bedrijfRow.waarde as BedrijfInput,
    opties: ctx.opties,
    colli,
  });
  const result = ctx.dryRun
    ? { ok: true, remotePad: 'DRY_RUN — niet geüpload', errorMsg: null }
    : await uploadXmlViaSftp(ctx.sftpConfig!, bestandsnaam, xml);

  // 3c. Audit (mig 325-patroon): één externe_payloads-rij per poging,
  //     best-effort — mag het versturen nooit blokkeren.
  try {
    await supabase.rpc('log_externe_payload', {
      p_kanaal: 'verhoek',
      p_payload_raw: xml,
      p_bron: 'verhoek',
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
    console.warn(`[verhoek-send] payload-audit faalde: ${String(e)}`);
  }

  // 4. Markeer succes/fout. Bij succes: XML-kopie naar storage (best-effort).
  if (result.ok) {
    let storagePath: string | null = null;
    try {
      const path = `verhoek-xml/${bestandsnaam}`;
      const { error: upErr } = await supabase.storage
        .from('order-documenten')
        .upload(path, new TextEncoder().encode(xml), { contentType: 'application/xml', upsert: true });
      if (!upErr) storagePath = path;
      else console.error(`[verhoek-send] storage-upload faalde: ${upErr.message}`);
    } catch (e) {
      console.error(`[verhoek-send] storage-upload exception: ${String(e)}`);
    }

    summary.succeeded += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'sent', bestandsnaam });
    const { error: markOkErr } = await supabase.rpc('markeer_verhoek_verstuurd', {
      p_id: row.id,
      p_bestandsnaam: bestandsnaam,
      p_xml_storage_path: storagePath,
      p_track_trace_id: (z.afl_email ?? '').trim() !== '' ? z.zending_nr : null,
      p_request_xml: xml,
    });
    if (markOkErr) console.error(`[verhoek-send] markeer_verhoek_verstuurd faalde voor rij ${row.id}: ${markOkErr.message}`);
  } else {
    summary.failed += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: result.errorMsg ?? 'onbekende fout' });
    const { error: markFoutErr } = await supabase.rpc('markeer_verhoek_fout', {
      p_id: row.id,
      p_error: result.errorMsg ?? 'onbekende fout',
      p_request_xml: xml,
      p_max_retries: 3,
    });
    if (markFoutErr) console.error(`[verhoek-send] markeer_verhoek_fout faalde voor rij ${row.id}: ${markFoutErr.message}`);
  }
}

async function markFoutMetSummary(
  supabase: SupabaseClient,
  row: VerhoekTransportOrderRow,
  summary: SendSummary,
  error: string,
): Promise<void> {
  summary.failed += 1;
  summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error });
  const { error: markErr } = await supabase.rpc('markeer_verhoek_fout', { p_id: row.id, p_error: error, p_max_retries: 3 });
  if (markErr) console.error(`[verhoek-send] markeer_verhoek_fout faalde voor rij ${row.id}: ${markErr.message}`);
}

function jsonResp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
