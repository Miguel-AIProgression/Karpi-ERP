// Identifiers van de twee dropshipment-kostenartikelen. Bewust TS-constant
// (zoals SHIPPING_PRODUCT_ID) — dit zijn stabiele product-sleutels, geen data
// die kan wijzigen. De PRIJZEN leven NIET hier maar in `producten.verkoopprijs`
// (ADR-0018, data-driven) en worden opgehaald via useDropshipPrijzen /
// fetchDropshipPrijzen. Reden: de DB-prijs werd al eens los gecorrigeerd
// (mig 363: 27,50→35,00) terwijl een hardcoded TS-constant apart mee moest —
// die divergentie is hiermee weg.
export const DROPSHIP_KLEIN_ID = 'DROPSHIP-KLEIN'
export const DROPSHIP_GROOT_ID = 'DROPSHIP-GROOT'

export type DropshipmentKeuze = 'nee' | 'klein' | 'groot'

/** Actuele dropship-prijzen uit `producten.verkoopprijs`. */
export interface DropshipPrijzen {
  klein: number
  groot: number
}
