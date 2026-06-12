// Supabase Edge Function: rhenus-send
//
// Cron-driven sender voor Rhenus-XML's (ADR-0032). Claimt 'Wachtrij'-rijen
// uit `rhenus_transportorders`, bouwt per zending een GS1
// TransportInstruction-XML (RHE 3.1) en levert die via SFTP aan bij Rhenus
// (/in-map). Audit: externe_payloads (kanaal 'rhenus', elke poging een rij)
// + XML-kopie in storage (order-documenten/rhenus-xml/).
//
// DRY-RUN (secret RHENUS_DRY_RUN, default 'true'): hele keten draait —
// XML, preflight, storage, audit, markeer — maar de SFTP-upload wordt
// overgeslagen. Go-live = RHENUS_DRY_RUN=false + RHENUS_SFTP_*-secrets.
//
// Auth: Bearer-CRON_TOKEN-header (zelfde patroon als hst-send/verhoek-send).
// Plan: docs/superpowers/plans/2026-06-12-rhenus-transporteur-gs1-xml-sftp.md

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { bouwRhenusBestandsnaam, bouwRhenusXml, valideerRhenusColli } from './xml-builder.ts';
import { type SftpConfig, uploadXmlViaSftp } from '../_shared/sftp-client.ts';
import { valideerVoorVervoerder } from '../_shared/vervoerder-eisen.ts';
import { DEFAULT_RHENUS_OPTIES } from './types.ts';
import type { BedrijfInput, RhenusColliInput, RhenusOpties, ZendingInput } from './types.ts';

const MAX_PER_RUN = 25;

interface RhenusTransportOrderRow {
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

  // Dry-run default AAN: zonder expliciete RHENUS_DRY_RUN=false gaat er
  // niets de deur uit. Veilige standaard tot de go-live-checklist (Fase 2).
  const dryRun = (Deno.env.get('RHENUS_DRY_RUN') ?? 'true').toLowerCase() !== 'false';

  let sftpConfig: SftpConfig | null = null;
  if (!dryRun) {
    const host = Deno.env.get('RHENUS_SFTP_HOST');
    const user = Deno.env.get('RHENUS_SFTP_USER');
    const password = Deno.env.get('RHENUS_SFTP_PASSWORD');
    if (!host || !user || !password) {
      return jsonResp({ error: 'RHENUS_DRY_RUN=false maar RHENUS_SFTP_HOST / USER / PASSWORD ontbreken' }, 500);
    }
    sftpConfig = {
      host,
      port: Number(Deno.env.get('RHENUS_SFTP_PORT') ?? '22'),
      username: user,
      password,
      // Mail Rhenus 12-06: bestanden afleveren in de /in-map; de testmap is
      // beschikbaar voor de rondreis (secret tijdelijk daarop zetten).
      remoteDir: Deno.env.get('RHENUS_SFTP_REMOTE_DIR') ?? '/in',
    };
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Runtime-config (mig 378): per run gelezen, dus een config-UPDATE werkt
  // zonder redeploy.
  const { data: cfgRow } = await supabase
    .from('app_config').select('waarde').eq('sleutel', 'rhenus').single();
  const opties: RhenusOpties = { ...DEFAULT_RHENUS_OPTIES, ...((cfgRow?.waarde ?? {}) as Partial<RhenusOpties>) };

  // Zelfhelend (mig 379-reaper): herstel rijen die vastliepen in 'Bezig'.
  try {
    const { data: hersteld } = await supabase.rpc('herstel_vastgelopen_rhenus', { p_minuten: 10 });
    if (hersteld && Number(hersteld) > 0) {
      console.log(`[rhenus-send] reaper: ${hersteld} vastgelopen Bezig-rij(en) terug naar Wachtrij`);
    }
  } catch (e) {
    console.warn(`[rhenus-send] reaper faalde: ${String(e)}`);
  }

  const summary: SendSummary = { processed: 0, succeeded: 0, failed: 0, empty_queue: false, dry_run: dryRun, details: [] };

  const runStart = Date.now();
  for (let i = 0; i < MAX_PER_RUN; i++) {
    // Tijdsbudget: ruim binnen de edge-wall-clock blijven; de rest van de
    // wachtrij pakt de volgende cron-run (elke minuut) op.
    if (Date.now() - runStart > 60_000) break;
    const { data: claimed, error: claimErr } = await supabase.rpc('claim_volgende_rhenus_transportorder');
    if (claimErr) return jsonResp({ error: `claim-rpc fout: ${claimErr.message}` }, 500);
    const row = claimed as RhenusTransportOrderRow | null;
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
      const { error: catchMarkErr } = await supabase.rpc('markeer_rhenus_fout', { p_id: row.id, p_error: `Onverwachte exception: ${String(err)}`, p_max_retries: 3 });
      if (catchMarkErr) console.error(`[rhenus-send] markeer_rhenus_fout faalde voor rij ${row.id}: ${catchMarkErr.message}`);
    }
  }

  return jsonResp(summary, 200);
});

interface VerwerkContext {
  sftpConfig: SftpConfig | null; // null in dry-run
  opties: RhenusOpties;
  dryRun: boolean;
}

async function verwerkRow(
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

  // Colli's mét lengte: maatwerk-dims van de orderregel, anders product-dims
  // (zelfde ladder als verhoek-send; expliciete FK-hint tegen PGRST201).
  const { data: colliRows, error: colliErr } = await supabase
    .from('zending_colli')
    .select('colli_nr, sscc, gewicht_kg, order_regels:order_regel_id ( maatwerk_lengte_cm, maatwerk_breedte_cm, producten:order_regels_artikelnr_fkey ( lengte_cm, breedte_cm ) )')
    .eq('zending_id', row.zending_id)
    .order('colli_nr', { ascending: true });
  if (colliErr) {
    return markFoutMetSummary(supabase, row, summary, `zending_colli query fout: ${colliErr.message}`);
  }
  // deno-lint-ignore no-explicit-any
  const colli: RhenusColliInput[] = ((colliRows ?? []) as any[]).map((r) => ({
    colli_nr: r.colli_nr,
    sscc: r.sscc,
    gewicht_kg: r.gewicht_kg,
    lengte_cm: r.order_regels?.maatwerk_lengte_cm ?? r.order_regels?.producten?.lengte_cm ?? null,
    breedte_cm: r.order_regels?.maatwerk_breedte_cm ?? r.order_regels?.producten?.breedte_cm ?? null,
  }));

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

async function markFoutMetSummary(
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

function jsonResp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
