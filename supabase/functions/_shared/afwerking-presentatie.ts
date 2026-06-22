// Gedeelde afwerking-presentatie voor klantdocumenten (orderbevestiging, pakbon,
// factuur). Eén plek voor de regel "bandkleur alleen tonen bij Breedband" —
// Smalband en Fur kennen óók een bandkleur in de data, maar die toont de klant
// nergens (besluit gebruiker 2026-06-18).

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
 * Stelt de afwerkingstekst samen: de afwerkingsnaam, en ALLEEN bij Breedband
 * (`type_bewerking === 'breedband'`) de gekozen bandkleur erachter —
 * "Breedband - band KK21". Voor elke andere afwerking (ook Smalband/Fur, die
 * ook een bandkleur kennen) komt er nooit een band in de tekst.
 *
 * Onbekende code → de code zelf als naam (defensief; de afwerking_types-tabel
 * verandert zelden maar mag een nieuw record missen in de cache).
 * Geen code → `null` (caller toont dan niets).
 */
export function afwerkingPresentatie(
  afwerkingCode: string | null | undefined,
  bandKleur: string | null | undefined,
  typeMap: AfwerkingTypeMap,
): string | null {
  if (!afwerkingCode) return null
  const info = typeMap.get(afwerkingCode)
  const naam = info?.naam ?? afwerkingCode
  const band = info?.type_bewerking === 'breedband' && bandKleur ? ` - band ${bandKleur}` : ''
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
