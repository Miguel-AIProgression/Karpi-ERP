// Intrastat-statistiekregel op buitenlandse (intracommunautaire)
// factuurregels (mig 446, herontworpen mig 450): 2 compacte regels —
// "Stat.nr.: 57024200   Herkomst: NL   Vervoer: RHE" /
// "Gewicht: 16 kg   M2: 4.00". Gedeeld tussen de on-demand PDF-preview
// (factuur-pdf) en de daadwerkelijk verzonden factuur (factuur-verzenden)
// zodat beide hetzelfde tonen (ADR-0033-patroon) — anders drift, zoals de
// bestaande m²-/gewicht-verrijking die alleen op het preview-pad zat.
//
// Mig 450-fix: de oorspronkelijke 1-regel-vorm ("Stat.nr./Land herkomst/
// Vervoer/Gewicht: CODE/NL/3/GEWICHT") liep bij alle 4 talen over de
// kolombreedte heen en werd afgekapt door truncateNaarBreedte() — Vervoer
// en Gewicht vielen daardoor stilletjes weg. Opgesplitst in 2 gegarandeerd
// passende regels; "Vervoer" toont nu ook de eerste 3 letters van de
// daadwerkelijke vervoerder (bv. "RHE" voor Rhenus) i.p.v. de kale
// CBS-vervoerswijze-cijfercode "3" — leesbaarder voor de klant. De
// CBS-exportview (mig 448) blijft de officiële numerieke code gebruiken
// (wettelijk vereist voor de Intrastat-aangifte, andere context dan deze
// klant-facing regel).

import { intracomLabels } from '../factuur-pdf.ts'
import type { Taal } from '../klant-taal.ts'

// Vaste waarde: Karpi's voorraad/productie zit in NL.
export const LAND_VAN_OORSPRONG = 'NL'

export interface M2Input {
  maatwerkOppervlakM2: number | string | null | undefined
  productLengteCm: number | null | undefined
  productBreedteCm: number | null | undefined
  productVorm: string | null | undefined
}

/** m² per stuk — maatwerk-snapshot wint, anders vast-product-maat (rond/rechthoek). */
export function bereekenM2PerStuk(input: M2Input): number {
  const maatwerkM2 = input.maatwerkOppervlakM2
  if (maatwerkM2 !== null && maatwerkM2 !== undefined && Number(maatwerkM2) > 0) {
    return Number(maatwerkM2)
  }
  if (input.productLengteCm && input.productBreedteCm) {
    if (input.productVorm === 'rond') {
      return Math.PI * Math.pow(input.productLengteCm / 200, 2)
    }
    return (input.productLengteCm * input.productBreedteCm) / 10000
  }
  return 0
}

export interface StatRegelInput {
  taal: Taal
  btwVerlegd: boolean
  goederencode: string | undefined
  gewichtKg: number | string | null | undefined
  m2Totaal: number
  /** Eerste 3 letters van de effectieve vervoerder (bv. "RHE", "HST"); undefined → '—'. */
  vervoerderCode: string | undefined
}

/** Bouwt de 2-regelige Stat.nr.-regel; undefined als niet van toepassing. */
export function bouwIntracomStatRegel(input: StatRegelInput): string | undefined {
  if (!input.btwVerlegd || !input.goederencode) return undefined
  const l = intracomLabels(input.taal)
  const gewichtRegel = input.gewichtKg !== null && input.gewichtKg !== undefined
    ? Math.round(Number(input.gewichtKg))
    : 0
  const vervoer = input.vervoerderCode ?? '—'
  const regel1 = `${l.statnr}: ${input.goederencode}   ${l.herkomst}: ${LAND_VAN_OORSPRONG}   ${l.vervoer}: ${vervoer}`
  const m2Suffix = input.m2Totaal > 0 ? `   M2: ${input.m2Totaal.toFixed(2)}` : ''
  const regel2 = `${l.gewicht}: ${gewichtRegel} kg${m2Suffix}`
  return `${regel1}\n${regel2}`
}

// deno-lint-ignore no-explicit-any
type SupabaseClient = any

/** Goederencode per kwaliteitscode, alleen voor de opgegeven codes. */
export async function fetchGoederencodePerKwaliteit(
  supabase: SupabaseClient,
  kwaliteitCodes: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (kwaliteitCodes.length === 0) return result
  const { data, error } = await supabase
    .from('kwaliteiten')
    .select('code, goederencode')
    .in('code', kwaliteitCodes)
  if (error) throw new Error(`Fetch kwaliteiten (goederencode): ${error.message}`)
  for (const k of (data ?? []) as { code: string; goederencode: string | null }[]) {
    if (k.goederencode) result.set(k.code, k.goederencode)
  }
  return result
}

/**
 * Effectieve vervoerder (eerste 3 letters, hoofdletters — bv. "RHE" voor
 * rhenus_sftp) per order_id, via de zending die de order daadwerkelijk
 * verzond (zending_orders → zendingen.vervoerder_code). Een order zonder
 * zending (nog niet verzonden) krijgt geen entry → caller toont '—'.
 */
export async function fetchVervoerderCodePerOrder(
  supabase: SupabaseClient,
  orderIds: number[],
): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  if (orderIds.length === 0) return result
  const { data, error } = await supabase
    .from('zending_orders')
    .select('order_id, zendingen ( vervoerder_code )')
    .in('order_id', orderIds)
  if (error) throw new Error(`Fetch zending_orders (vervoerder): ${error.message}`)
  for (const row of (data ?? []) as { order_id: number; zendingen: { vervoerder_code: string | null } | null }[]) {
    const code = row.zendingen?.vervoerder_code
    if (code && !result.has(row.order_id)) {
      result.set(row.order_id, code.slice(0, 3).toUpperCase())
    }
  }
  return result
}
