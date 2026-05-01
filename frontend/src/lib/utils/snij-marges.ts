// Frontend-kopie van supabase/functions/_shared/snij-marges.ts
// Houd synchroon met de backend-versie en met supabase/migrations/181_snij_marge_vormen_uitbreiding.sql

const AFWERKING_MARGE_CM: Record<string, number> = {
  ZO: 6,
}

// Houd synchroon met supabase/migrations/181_snij_marge_vormen_uitbreiding.sql
// en supabase/functions/_shared/snij-marges.ts
const NIET_RECHTHOEKIGE_VORMEN = new Set([
  'rond', 'ovaal',
  'organisch_a', 'organisch_b_sp',
  'pebble', 'ellips', 'afgeronde_hoeken',
])

/**
 * Extra snij-cm voor een stuk op basis van afwerking en vorm.
 * ZO: +6 cm, niet-rechthoekige vormen: +5 cm. Bij combi: grootste wint.
 */
export function snijMargeCm(
  afwerking: string | null | undefined,
  vorm: string | null | undefined,
): number {
  const afwerkingMarge = afwerking ? (AFWERKING_MARGE_CM[afwerking] ?? 0) : 0
  const vormMarge = vorm && NIET_RECHTHOEKIGE_VORMEN.has(vorm.toLowerCase()) ? 5 : 0
  return Math.max(afwerkingMarge, vormMarge)
}

/** True als de vorm een snij-marge nodig heeft (rond, ovaal, organisch, pebble, ellips, afgeronde hoeken). */
export function isNietRechthoekigeVorm(vorm: string | null | undefined): boolean {
  return !!vorm && NIET_RECHTHOEKIGE_VORMEN.has(vorm.toLowerCase())
}
