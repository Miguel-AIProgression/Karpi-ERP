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

/** Minimale wachtrij-rij die de skeleton aanraakt. Carriers breiden uit.
 *  `extern_referentie` draagt bij SFTP de (eerder gepersisteerde) bestandsnaam,
 *  zodat een retry dezelfde naam hergebruikt. */
export interface VerzendRijBasis {
  id: number;
  zending_id: number;
  extern_referentie?: string | null;
}

/** Minimale samenvatting-shape; de adapter-`noteer*`-hooks doen de eigen
 *  bookkeeping (succeeded/failed/details) — de skeleton roept de RPC's aan. */
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

/** Het punt in de sequence waar een pre-verzending-fout optrad. De adapter mag
 *  dit gebruiken voor zijn `summary.details`-vorm (HST logt fase-codes i.p.v. de
 *  melding); Verhoek/Rhenus negeren het en loggen de melding. */
export type VerzendFase =
  | 'zending'
  | 'order'
  | 'bedrijf'
  | 'colli_query'
  | 'geen_colli'
  | 'preflight'
  | 'bestandsnaam';

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
  /** Vervoerder-code: discriminator voor de generieke wachtrij-RPC's (ADR-0038)
   *  én de preflight-key (ADR-0034). Bv. 'hst_api'|'verhoek_sftp'|'rhenus_sftp'. */
  vervoerderCode: string;
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

  /** Genereert een bestandsnaam wanneer de rij er nog geen heeft (SFTP-dedup).
   *  Aanwezigheid schakelt de persist-stap in (extern_referentie op
   *  verzend_wachtrij); HST/REST laat 'm weg. */
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

  /** Bewaart het verzendartefact (PDF voor HST, XML voor SFTP) in storage en
   *  geeft het pad terug (of null) → de skeleton zet 't als document_pad in
   *  markeer_transportorder_verstuurd. Best-effort: een upload-fout geeft null
   *  + console.error en mag het verzend-succes niet ongedaan maken. */
  bewaarArtefact(supabase: SupabaseClient, z: VerzendZending, payload: Payload, r: R, bestandsnaam: string | null): Promise<string | null>;

  /** Mapt het transport-resultaat naar de generieke verstuurd-velden. trackTrace
   *  null → geen T&T (Rhenus); de skeleton geeft 't door aan markeer_*_verstuurd. */
  uitkomst(z: VerzendZending, payload: Payload, r: R, bestandsnaam: string | null): { externReferentie: string | null; trackTrace: string | null };

  /** Summary-cosmetica (carrier-specifieke `details`-vorm). De skeleton doet de
   *  markeer-RPC-aanroepen zelf; deze hooks raken alléén de summary. */
  noteerSucces(row: Row, r: R, bestandsnaam: string | null, summary: VerzendSummaryBasis): void;
  noteerFout(row: Row, r: R, summary: VerzendSummaryBasis): void;
  noteerMarkFout(row: Row, melding: string, fase: VerzendFase, summary: VerzendSummaryBasis): void;
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
  // Pre-verzending-fout: generieke markeer-fout-RPC + adapter-summary-cosmetica.
  // Vervangt de oude per-carrier `adapter.markFout` (ADR-0038: geen RPC-naam meer
  // in de adapter).
  const faal = async (melding: string, fase: VerzendFase): Promise<void> => {
    await supabase.rpc('markeer_transportorder_fout', { p_id: row.id, p_error: melding, p_max_retries: 3 });
    adapter.noteerMarkFout(row, melding, fase, summary);
  };

  // 1. Context-data ophalen.
  const { data: zending, error: zErr } = await supabase
    .from('zendingen')
    .select(adapter.zendingSelect)
    .eq('id', row.zending_id)
    .single();
  if (zErr || !zending) {
    return faal(`Zending ${row.zending_id} niet gevonden: ${zErr?.message ?? 'leeg'}`, 'zending');
  }
  const z = zending as unknown as VerzendZending;

  const { data: order, error: oErr } = await supabase
    .from('orders').select(adapter.orderSelect).eq('id', z.order_id).single();
  if (oErr || !order) {
    return faal(`Order ${z.order_id} niet gevonden: ${oErr?.message ?? 'leeg'}`, 'order');
  }

  const { data: bedrijfRow, error: bErr } = await supabase
    .from('app_config').select('waarde').eq('sleutel', 'bedrijfsgegevens').single();
  if (bErr || !(bedrijfRow as { waarde?: unknown } | null)?.waarde) {
    return faal(`bedrijfsgegevens-record ontbreekt in app_config: ${bErr?.message ?? 'leeg'}`, 'bedrijf');
  }
  const bedrijf = (bedrijfRow as { waarde: unknown }).waarde;

  // Colli via de Zending-colli-seam (één canonieke bron, mig 399).
  const { colli, error: colliErr } = await fetchZendingColli(supabase, row.zending_id);
  if (colliErr) {
    return faal(`zending_colli query fout: ${colliErr}`, 'colli_query');
  }
  if (adapter.hardFailOnZeroColli && colli.length === 0) {
    return faal(adapter.zeroColliMelding(row.zending_id), 'geen_colli');
  }

  // 2. Pre-flight: adres (capability-seam) + carrier-colli + carrier-extra.
  //    Faalt iets → direct Fout met heldere reden, géén kansloze verzending
  //    (ADR-0030-principe).
  const redenen = [
    ...valideerVoorVervoerder({
      vervoerder_code: adapter.vervoerderCode,
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
    return faal('Pre-flight: ' + redenen.join(' | '), 'preflight');
  }

  // 3. Bestandsnaam (SFTP-dedup): eenmalig genereren en vóór de upload
  //    persisteren (in verzend_wachtrij.extern_referentie) zodat een retry
  //    dezelfde naam hergebruikt.
  let bestandsnaam: string | null = null;
  if (adapter.maakBestandsnaam) {
    bestandsnaam = row.extern_referentie ?? adapter.maakBestandsnaam(z, ctx);
    if (!row.extern_referentie) {
      const { error: naamErr } = await supabase
        .from('verzend_wachtrij')
        .update({ extern_referentie: bestandsnaam })
        .eq('id', row.id);
      if (naamErr) {
        return faal(`bestandsnaam persisteren faalde: ${naamErr.message}`, 'bestandsnaam');
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

  // 6. Markeer succes/fout via de GENERIEKE wachtrij-RPC's (ADR-0038). De
  //    adapter levert alleen het carrier-specifieke deel: het artefact bewaren
  //    (PDF/XML → document_pad), de uitkomst-mapping (extern_referentie/
  //    track_trace) en de summary-cosmetica.
  if (ok) {
    const documentPad = await adapter.bewaarArtefact(supabase, z, payload, result, bestandsnaam);
    const { externReferentie, trackTrace } = adapter.uitkomst(z, payload, result, bestandsnaam);
    await supabase.rpc('markeer_transportorder_verstuurd', {
      p_id: row.id,
      p_extern_referentie: externReferentie,
      p_track_trace: trackTrace,
      p_document_pad: documentPad,
    });
    adapter.noteerSucces(row, result, bestandsnaam, summary);
  } else {
    await supabase.rpc('markeer_transportorder_fout', {
      p_id: row.id,
      p_error: adapter.resultFout(result) ?? 'onbekende fout',
      p_max_retries: 3,
    });
    adapter.noteerFout(row, result, summary);
  }
}
