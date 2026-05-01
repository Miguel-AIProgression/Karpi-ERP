// Snij-marges: extra cm bij snijden t.o.v. bestelde maat.
//
// ZO-afwerking: 6 cm rondom nodig (de afwerk-rand eet 6 cm op, dus een 120x120
// klant-stuk wordt als 126x126 gesneden en daarna afgewerkt naar 120x120).
//
// Niet-rechthoekige vormen: 5 cm speling omdat de vorm met de hand wordt
// uitgezaagd — de rechthoekige snede moet ruim genoeg zijn om de ronding /
// organische contour vrij te houden.
//
// Bij combi (ZO + niet-rechthoekige vorm) nemen we de grootste marge
// (niet cumulatief) zodat de opgeslagen brutomaat niet onnodig groeit.
//
// Houd synchroon met:
//   supabase/migrations/181_snij_marge_vormen_uitbreiding.sql
//   frontend/src/lib/utils/snij-marges.ts

const AFWERKING_MARGE_CM: Record<string, number> = {
  ZO: 6,
}

// Houd synchroon met supabase/migrations/181_snij_marge_vormen_uitbreiding.sql
// en frontend/src/lib/utils/snij-marges.ts
const NIET_RECHTHOEKIGE_VORMEN = new Set([
  'rond', 'ovaal',
  'organisch_a', 'organisch_b_sp',
  'pebble', 'ellips', 'afgeronde_hoeken',
])

export function snijMargeCm(
  afwerking: string | null | undefined,
  vorm: string | null | undefined,
): number {
  const afwerkingMarge = afwerking ? (AFWERKING_MARGE_CM[afwerking] ?? 0) : 0
  const vormMarge = vorm && NIET_RECHTHOEKIGE_VORMEN.has(vorm.toLowerCase()) ? 5 : 0
  return Math.max(afwerkingMarge, vormMarge)
}

/**
 * Geeft terug of een vorm niet-rechthoekig is (rond, ovaal, organisch, pebble,
 * ellips, afgeronde hoeken). Dit zijn vormen waarvoor een extra snijmarge nodig is.
 */
export function isNietRechthoekigeVorm(vorm: string | null | undefined): boolean {
  return !!vorm && NIET_RECHTHOEKIGE_VORMEN.has(vorm.toLowerCase())
}
