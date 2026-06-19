// Factuur-product-titel — de klant-facing regel-omschrijving op de PDF-factuur:
// "kwaliteitnaam (of klant-eigennaam) − afmeting", bv. "Galaxy - 60x90 cm".
//
// Spiegelt de verzendlabel-logica (vasteMaatRegels/productMaat in
// shipping-label-data.ts, besluit 2026-06-18): kwaliteitnaam uit
// producten.vervolgomschrijving, maat met de kleinste zijde eerst. Klant-eigennaam
// (resolve_klanteigen_naam, mig 199/200) wint van de kwaliteitnaam als die bestaat.
//
// Pure functie (geen DB) — de caller levert de al-geresolvde klant-eigennaam.
// Retourneert null als er geen naam óf geen maat is → de caller valt dan terug op
// de bestaande omschrijving (VERZEND/toeslagen/admin-pseudo blijven ongewijzigd).

import { kwaliteitNaamUitVervolg } from '../kwaliteit-naam.ts'

export interface FactuurProductTitelInput {
  /** order_regels.is_maatwerk — bepaalt welke maat-bron telt. */
  isMaatwerk: boolean
  /** Maatwerk-maten (order_regels.maatwerk_*_cm); alleen relevant bij maatwerk. */
  maatwerkLengteCm: number | null
  maatwerkBreedteCm: number | null
  /** producten.vervolgomschrijving — bron voor de kwaliteitnaam. */
  vervolgomschrijving: string | null
  /** Vaste-maat-product (producten.*_cm); relevant als niet-maatwerk. */
  prodLengteCm: number | null
  prodBreedteCm: number | null
  /** Al-geresolvde klant-eigennaam (resolve_klanteigen_naam) of null. */
  klantEigenNaam: string | null
}

/**
 * Bouw de klant-facing titel of retourneer null als die niet samen te stellen is.
 * Beide (naam én afmeting) verplicht — zo krijgen niet-tapijt-regels geen kale of
 * onzinnige titel (zelfde gate als vasteMaatRegels op het verzendlabel).
 */
export function factuurProductTitel(input: FactuurProductTitelInput): string | null {
  const klanteigen = input.klantEigenNaam?.trim()
  const naam = (klanteigen && klanteigen.length > 0)
    ? klanteigen
    : kwaliteitNaamUitVervolg(input.vervolgomschrijving)
  if (!naam) return null

  const lengte = input.isMaatwerk ? input.maatwerkLengteCm : input.prodLengteCm
  const breedte = input.isMaatwerk ? input.maatwerkBreedteCm : input.prodBreedteCm
  if (!lengte || !breedte || lengte <= 0 || breedte <= 0) return null

  const klein = Math.min(lengte, breedte)
  const groot = Math.max(lengte, breedte)
  return `${naam} - ${klein}x${groot} cm`
}
