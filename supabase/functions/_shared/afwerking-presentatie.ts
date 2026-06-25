// Gedeelde afwerking-presentatie voor klantdocumenten (orderbevestiging, pakbon,
// factuur). Alleen Breedband (+ bandkleur), Volume afwerking en Onafgewerkt (ON)
// verschijnen op klantdocumenten — alle andere zijn interne productie-codes
// (besluit gebruiker 2026-06-26).

// Geen esm.sh-import van SupabaseClient (zoals factuur-document.ts): dit bestand
// wordt cross-root naar de frontend geshimd (ADR-0033) en `tsc -b` (Node/bundler-
// mode) kan die remote URL niet resolven. `fetchAfwerkingTypeMap` is de enige
// IO-functie hier en wordt door de frontend-shim bewust niet re-exporteerd.
// deno-lint-ignore no-explicit-any
type SupabaseClient = any

export interface AfwerkingInfo {
  naam: string
  type_bewerking: string | null
}

export type AfwerkingTypeMap = Map<string, AfwerkingInfo>

/**
 * Stelt de afwerkingstekst samen voor klantdocumenten (pakbon, orderbevestiging,
 * factuur). Toont ALLEEN Breedband (+ bandkleur), Volume afwerking en Onafgewerkt.
 * Alle andere afwerkingen (Smalband, ZO, Feston, …) geven `null` — de caller
 * toont dan geen afwerkingregel.
 */
export function afwerkingPresentatie(
  afwerkingCode: string | null | undefined,
  bandKleur: string | null | undefined,
  typeMap: AfwerkingTypeMap,
): string | null {
  if (!afwerkingCode) return null
  const info = typeMap.get(afwerkingCode)
  const type = info?.type_bewerking

  // Whitelist: breedband, volume afwerking, en Onafgewerkt (ON heeft type_bewerking=null).
  if (type !== 'breedband' && type !== 'volume afwerking' && afwerkingCode !== 'ON') return null

  const naam = info?.naam ?? afwerkingCode
  const band = type === 'breedband' && bandKleur ? ` - band ${bandKleur}` : ''
  return `${naam}${band}`
}

/** Haalt de kleine `afwerking_types`-tabel (9 rijen) ééns op als code → info-map. */
export async function fetchAfwerkingTypeMap(supabase: SupabaseClient): Promise<AfwerkingTypeMap> {
  const { data, error } = await supabase.from('afwerking_types').select('code, naam, type_bewerking')
  if (error) throw new Error(`Fetch afwerking_types: ${error.message}`)
  const map: AfwerkingTypeMap = new Map()
  for (const row of (data ?? []) as Array<{ code: string; naam: string; type_bewerking: string | null }>) {
    map.set(row.code, { naam: row.naam, type_bewerking: row.type_bewerking })
  }
  return map
}
