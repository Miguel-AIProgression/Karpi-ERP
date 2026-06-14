// Verzend-orchestrator-skeleton (ADR-0035, process-as). De drie verzend-adapters
// (HST/Verhoek/Rhenus) deelden een vrijwel identiek per-rij-skelet: fetch zending/
// order/bedrijf → colli → 0-colli-guard → preflight → bestandsnaam → build →
// transport → audit (log_externe_payload) → markeer succes/fout. Alleen het
// RENDEREN (payload/XML) en het TRANSPORT (REST vs SFTP) zijn carrier-specifiek.
//
// Deze module draagt die SEQUENCE één keer; een `VerzendAdapter` levert wat écht
// per carrier verschilt. Zo blijven reaper/claim-loop (in de adapter-`index.ts`)
// en deze rij-verwerking gescheiden, en concentreert de fetch-/preflight-/audit-
// logica zich op één plek (vangnet: de drie `verwerk-row.test.ts`-karakterisaties).
//
// NIET puur (raakt de DB-client) → edge-only, geen frontend-deling (ADR-0033).
//
// Scope slice 1 (ADR-0035): de PER-RIJ-verwerking. De wachtrij-loop + secret-/
// dry-run-resolutie blijven (nog) in elke `index.ts` — die env-resolutie is
// carrier-specifiek. Verhoek rijdt als eerste op deze skeleton; Rhenus (slice 2)
// en HST (slice 3) volgen incrementeel, elk test-geborgd.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { valideerVoorVervoerder } from './vervoerder-eisen.ts';
import { type ZendingColli } from './vervoerders/fetch-zending-colli.ts';
import { fetchZendingColli } from './vervoerders/fetch-zending-colli.ts';

/** Minimale wachtrij-rij die de skeleton aanraakt. Carriers breiden uit. */
export interface VerzendRijBasis {
  id: number;
  zending_id: number;
  bestandsnaam?: string | null;
}

/** Minimale samenvatting-shape; de adapter-callbacks doen de eigen bookkeeping
 *  (succeeded/failed/details), exact zoals de oude `markFoutMetSummary`. */
export interface VerzendSummaryBasis {
  succeeded: number;
  failed: number;
  details: Array<Record<string, unknown>>;
}

/** De zending-rij na fetch — de velden die de skeleton zelf leest (preflight +
 *  audit-order_id). De adapter krijgt 'm door en mag extra velden lezen. */
export interface VerzendZending {
  order_id: number;
  zending_nr: string;
  afl_naam: string | null;
  afl_adres: string | null;
  afl_postcode: string | null;
  afl_plaats: string | null;
  afl_land: string | null;
  afl_telefoon: string | null;
  [k: string]: unknown;
}

/** Context-data die de skeleton ophaalt en aan de build-/verstuur-callbacks geeft. */
export interface VerzendContextData {
  z: VerzendZending;
  order: Record<string, unknown>;
  bedrijf: unknown;
  colli: ZendingColli[];
}

/**
 * Carrier-adapter: alles wat écht per vervoerder verschilt. De skeleton roept
 * deze hooks in vaste volgorde aan.
 *
 * @typeParam Row     wachtrij-rij-type (≥ VerzendRijBasis)
 * @typeParam Ctx     per-run context (secrets/dry-run/opties) — opaque voor de skeleton
 * @typeParam Payload het gerenderde bericht (HST-JSON-object of XML-string)
 * @typeParam R       het transport-resultaat (HstResponse of SftpUploadResult)
 */
export interface VerzendAdapter<Row extends VerzendRijBasis, Ctx, Payload, R> {
  /** Audit-kanaal + bron ('hst'|'verhoek'|'rhenus'). */
  kanaal: string;
  /** Capability-code voor de preflight (ADR-0034). */
  capabilityCode: string;
  /** MIME voor de audit-rij. */
  contentType: string;
  /** Kolomlijst voor de `zendingen`-fetch (carrier leest verschillende velden). */
  zendingSelect: string;
  /** Kolomlijst voor de `orders`-fetch ('order_nr' of 'order_nr, klant_referentie'). */
  orderSelect: string;

  /** Faalt een lege zending hard vóór de preflight (HST/Verhoek: scanner-eis),
   *  of loopt 0-colli via de preflight (Rhenus: incident 0455395)? */
  hardFailOnZeroColli: boolean;
  /** Melding bij de harde 0-colli-fout (alleen als hardFailOnZeroColli). */
  zeroColliMelding(zendingId: number): string;

  /** Carrier-specifieke colli-preflight-meldingen (valideerVerhoek/RhenusColli);
   *  HST levert []. */
  preflightColli(colli: ZendingColli[]): string[];
  /** Extra preflight-redenen buiten adres/colli (Verhoek: opdrachtgever_nummer). */
  preflightExtra?(ctx: Ctx, z: VerzendZending, colli: ZendingColli[]): string[];

  /** Tabel waarin de bestandsnaam (SFTP-dedup) gepersisteerd wordt, of `null`
   *  als de carrier geen bestandsnaam kent (HST/REST). */
  bestandsnaamTabel: string | null;
  /** Genereert een bestandsnaam wanneer de rij er nog geen heeft (SFTP). */
  maakBestandsnaam?(z: VerzendZending, ctx: Ctx): string;

  /** Rendert het bericht (pure builder). */
  bouwPayload(input: VerzendContextData & { ctx: Ctx; bestandsnaam: string | null }): Payload;
  /** Letterlijke payload voor de audit-`p_payload_raw` (JSON.stringify of de XML). */
  payloadRaw(payload: Payload): string;

  /** Levert af: REST-POST, SFTP-put, of dry-run. */
  transport(ctx: Ctx, payload: Payload, bestandsnaam: string | null): Promise<R>;
  resultOk(r: R): boolean;
  resultFout(r: R): string | null;

  /** Externe-id voor de audit-rij (bestandsnaam, of transport_order_id/zending_nr). */
  auditExterneId(bestandsnaam: string | null, r: R, z: VerzendZending): string | null;
  /** Carrier-specifieke audit-`p_payload_json`-body. */
  auditPayloadJson(payload: Payload, r: R, bestandsnaam: string | null, ctx: Ctx): unknown;

  /** Succes-afhandeling: storage (PDF/XML) + markeer_*_verstuurd + summary. */
  onSucces(
    supabase: SupabaseClient,
    row: Row,
    ctx: Ctx,
    z: VerzendZending,
    payload: Payload,
    r: R,
    bestandsnaam: string | null,
    summary: VerzendSummaryBasis,
  ): Promise<void>;
  /** Fout-afhandeling: markeer_*_fout + summary. */
  onFout(
    supabase: SupabaseClient,
    row: Row,
    payload: Payload,
    r: R,
    summary: VerzendSummaryBasis,
  ): Promise<void>;

  /** Markeer-fout vóór verzending (fetch-fout/preflight): markeer_*_fout + summary. */
  markFout(supabase: SupabaseClient, row: Row, summary: VerzendSummaryBasis, melding: string): Promise<void>;
}

/**
 * Verwerk één wachtrij-rij volgens het gedeelde skelet. Reproduceert exact de
 * volgorde en foutmeldingen van de oude per-carrier `verwerkRow`.
 */
export async function verwerkVerzendRij<Row extends VerzendRijBasis, Ctx, Payload, R>(
  adapter: VerzendAdapter<Row, Ctx, Payload, R>,
  supabase: SupabaseClient,
  row: Row,
  ctx: Ctx,
  summary: VerzendSummaryBasis,
): Promise<void> {
  // 1. Context-data ophalen.
  const { data: zending, error: zErr } = await supabase
    .from('zendingen')
    .select(adapter.zendingSelect)
    .eq('id', row.zending_id)
    .single();
  if (zErr || !zending) {
    return adapter.markFout(supabase, row, summary, `Zending ${row.zending_id} niet gevonden: ${zErr?.message ?? 'leeg'}`);
  }
  const z = zending as unknown as VerzendZending;

  const { data: order, error: oErr } = await supabase
    .from('orders').select(adapter.orderSelect).eq('id', z.order_id).single();
  if (oErr || !order) {
    return adapter.markFout(supabase, row, summary, `Order ${z.order_id} niet gevonden: ${oErr?.message ?? 'leeg'}`);
  }

  const { data: bedrijfRow, error: bErr } = await supabase
    .from('app_config').select('waarde').eq('sleutel', 'bedrijfsgegevens').single();
  if (bErr || !(bedrijfRow as { waarde?: unknown } | null)?.waarde) {
    return adapter.markFout(supabase, row, summary, `bedrijfsgegevens-record ontbreekt in app_config: ${bErr?.message ?? 'leeg'}`);
  }
  const bedrijf = (bedrijfRow as { waarde: unknown }).waarde;

  // Colli via de Zending-colli-seam (één canonieke bron, mig 399).
  const { colli, error: colliErr } = await fetchZendingColli(supabase, row.zending_id);
  if (colliErr) {
    return adapter.markFout(supabase, row, summary, `zending_colli query fout: ${colliErr}`);
  }
  if (adapter.hardFailOnZeroColli && colli.length === 0) {
    return adapter.markFout(supabase, row, summary, adapter.zeroColliMelding(row.zending_id));
  }

  // 2. Pre-flight: adres (capability-seam) + carrier-colli + carrier-extra.
  //    Faalt iets → direct Fout met heldere reden, géén kansloze verzending
  //    (ADR-0030-principe).
  const redenen = [
    ...valideerVoorVervoerder({
      vervoerder_code: adapter.capabilityCode,
      afl_land: z.afl_land,
      afl_telefoon: z.afl_telefoon,
      afl_naam: z.afl_naam,
      afl_adres: z.afl_adres,
      afl_postcode: z.afl_postcode,
      afl_plaats: z.afl_plaats,
    }).problemen.map((p) => p.melding),
    ...adapter.preflightColli(colli),
    ...(adapter.preflightExtra?.(ctx, z, colli) ?? []),
  ];
  if (redenen.length > 0) {
    return adapter.markFout(supabase, row, summary, 'Pre-flight: ' + redenen.join(' | '));
  }

  // 3. Bestandsnaam (SFTP-dedup): eenmalig genereren en vóór de upload
  //    persisteren zodat een retry dezelfde naam hergebruikt.
  let bestandsnaam: string | null = null;
  if (adapter.bestandsnaamTabel && adapter.maakBestandsnaam) {
    bestandsnaam = row.bestandsnaam ?? adapter.maakBestandsnaam(z, ctx);
    if (!row.bestandsnaam) {
      const { error: naamErr } = await supabase
        .from(adapter.bestandsnaamTabel)
        .update({ bestandsnaam })
        .eq('id', row.id);
      if (naamErr) {
        return adapter.markFout(supabase, row, summary, `bestandsnaam persisteren faalde: ${naamErr.message}`);
      }
    }
  }

  // 4. Render + transport.
  const payload = adapter.bouwPayload({ z, order: order as unknown as Record<string, unknown>, bedrijf, colli, ctx, bestandsnaam });
  const result = await adapter.transport(ctx, payload, bestandsnaam);
  const ok = adapter.resultOk(result);

  // 5. Audit (mig 325): één externe_payloads-rij per poging, best-effort —
  //    mag het versturen nooit blokkeren.
  try {
    await supabase.rpc('log_externe_payload', {
      p_kanaal: adapter.kanaal,
      p_payload_raw: adapter.payloadRaw(payload),
      p_bron: adapter.kanaal,
      p_externe_id: adapter.auditExterneId(bestandsnaam, result, z),
      p_content_type: adapter.contentType,
      p_headers: null,
      p_payload_json: adapter.auditPayloadJson(payload, result, bestandsnaam, ctx),
      p_richting: 'out',
      p_order_id: z.order_id ?? null,
      p_status: ok ? 'verwerkt' : 'fout',
      p_fout: ok ? null : (adapter.resultFout(result) ?? 'onbekende fout'),
    });
  } catch (e) {
    console.warn(`[${adapter.kanaal}-send] payload-audit faalde: ${String(e)}`);
  }

  // 6. Markeer succes/fout.
  if (ok) {
    await adapter.onSucces(supabase, row, ctx, z, payload, result, bestandsnaam, summary);
  } else {
    await adapter.onFout(supabase, row, payload, result, summary);
  }
}
