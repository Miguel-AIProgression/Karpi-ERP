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

/**
 * Bereken gewicht (kg/stuk) voor een catalogus-product op basis van afmetingen,
 * vorm en kwaliteit-density. TS-spiegel van SQL-resolver
 * `bereken_product_gewicht_kg` (mig 185, vorm-logica mig 188).
 *
 * - `rond`: cirkel-oppervlak `π × (lengte/200)² × density` — `lengte` is hier
 *   de diameter in cm (gelijk aan breedte in DB).
 * - `rechthoek` (incl. ovaal-bbox): `lengte × breedte / 10000 × density`.
 *
 * Returnt undefined bij ontbrekende invoer. Caller kan dit dan vergelijken
 * met de cache (`producten.gewicht_kg`) of een fallback tonen.
 */
export function berekenProductGewichtKg(params: {
  lengte_cm: number | null | undefined
  breedte_cm: number | null | undefined
  vorm: 'rechthoek' | 'rond' | null | undefined
  gewichtPerM2Kg: number | null | undefined
}): number | undefined {
  const { lengte_cm, breedte_cm, vorm, gewichtPerM2Kg } = params
  if (!gewichtPerM2Kg || !lengte_cm || !breedte_cm) return undefined
  if (vorm === 'rond') {
    return Math.round(Math.PI * (lengte_cm / 200) ** 2 * gewichtPerM2Kg * 100) / 100
  }
  return Math.round(((lengte_cm * breedte_cm) / 10000) * gewichtPerM2Kg * 100) / 100
}
