// Intrastat/CBS-statistiekregel op buitenlandse (intracommunautaire)
// factuurregels (mig 446): "Stat.nr./Land herkomst/Vervoer/Gewicht:
// 57024200/NL/3/16" + "M2: 4.00", exact zoals het oude systeem. Gedeeld
// tussen de on-demand PDF-preview (factuur-pdf) en de daadwerkelijk
// verzonden factuur (factuur-verzenden) zodat beide hetzelfde tonen
// (ADR-0033-patroon) — anders drift, zoals de bestaande m²-/gewicht-
// verrijking die alleen op het preview-pad zat.

import { intracomRegelLabel } from '../factuur-pdf.ts'
import type { Taal } from '../klant-taal.ts'

// Vaste waarden: Karpi's voorraad/productie zit in NL, buitenlandse
// leveringen gaan vrijwel altijd over de weg. Zelfde constanten als de
// CBS-exportview (cbs_intrastat_export, mig 448).
export const LAND_VAN_OORSPRONG = 'NL'
export const VERVOERSWIJZE_WEG = '3'

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
}

/** Bouwt de Stat.nr.-regel (+ optionele M2-regel); undefined als niet van toepassing. */
export function bouwIntracomStatRegel(input: StatRegelInput): string | undefined {
  if (!input.btwVerlegd || !input.goederencode) return undefined
  const gewichtRegel = input.gewichtKg !== null && input.gewichtKg !== undefined
    ? Math.round(Number(input.gewichtKg))
    : 0
  const m2Regel = input.m2Totaal > 0 ? `\nM2: ${input.m2Totaal.toFixed(2)}` : ''
  return `${intracomRegelLabel(input.taal)}: ${input.goederencode}/${LAND_VAN_OORSPRONG}/${VERVOERSWIJZE_WEG}/${gewichtRegel}${m2Regel}`
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
