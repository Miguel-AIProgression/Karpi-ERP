/**
 * Gewicht-helpers (frontend-zijde).
 *
 * De bron-van-waarheid voor gewicht-density leeft in `kwaliteiten.gewicht_per_m2_kg`
 * (DB-laag, sinds mig 184/185). Frontend krijgt density via fetch en gebruikt deze
 * pure helper voor display-berekeningen tijdens regel-aanmaak.
 *
 * Voor persistente waarden (`order_regels.gewicht_kg`, `producten.gewicht_kg`)
 * is de DB-resolver leidend — niet deze helper. Zie SQL-functie
 * `bereken_orderregel_gewicht_kg` (mig 185).
 */

/**
 * Bereken gewicht (kg/stuk) op basis van oppervlak en kwaliteit-density.
 * Geretourneerd in 2 decimalen. Returnt undefined als density NULL is of
 * oppervlak ≤ 0 — caller toont dan typisch geen gewicht of een fallback.
 */
export function berekenGewichtKg(oppervlakM2: number, gewichtPerM2Kg: number | null): number | undefined {
  if (!gewichtPerM2Kg || oppervlakM2 <= 0) return undefined
  return Math.round(oppervlakM2 * gewichtPerM2Kg * 100) / 100
}
