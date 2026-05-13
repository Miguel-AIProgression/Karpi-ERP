/**
 * Predikaat: is deze orderregel een administratieve correctie zonder
 * fysieke leverbaarheid (VERZEND/BUNDELKORTING/DREMPELKORTING)?
 *
 * Bron-van-waarheid: `producten.is_pseudo BOOLEAN` (mig 272, ADR-0018).
 * De boolean reist mee in queries via `producten ( is_pseudo )` — er is
 * géén hardcoded artikelnr-lijst in TS, dus drift met de DB is onmogelijk.
 *
 * LET OP: voor *toe-voegen* van een nieuwe verzendregel
 * (bv. `applyShippingLogic` in `verzend-regel.ts`) is `SHIPPING_PRODUCT_ID
 * = 'VERZEND'` de juiste constant — niet deze helper. Skip en construct
 * zijn verschillende semantieken.
 */
/**
 * Twee shapes worden geaccepteerd:
 *
 * 1. Query-resultaten met een `producten ( is_pseudo )`-join uit Supabase —
 *    typisch reserveringen-, pickbaarheid- en orderregel-queries.
 * 2. Form-data (`OrderRegelFormData`) met `is_pseudo` als display-only
 *    top-level veld, gevuld bij artikel-keuze of bij form-load.
 *
 * Beide routes lezen uit dezelfde DB-bron-van-waarheid `producten.is_pseudo`;
 * de helper doet alleen de shape-disambiguation.
 */
export interface RegelMetProductPseudoFlag {
  is_pseudo?: boolean | null
  producten?: { is_pseudo?: boolean | null } | null
}

export function isAdminPseudo(
  regel: RegelMetProductPseudoFlag | null | undefined,
): boolean {
  if (!regel) return false
  return regel.is_pseudo === true
    || regel.producten?.is_pseudo === true
}
