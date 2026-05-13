/**
 * Artikelnr voor de auto-gegenereerde VERZEND-orderregel.
 *
 * SCOPE: deze constant bedient ALLEEN de TOE-VOEG-semantiek
 * (applyShippingLogic in `lib/orders/verzend-regel.ts` construeert een
 * nieuwe orderregel met dit artikelnr). Voor SKIP-detectie van admin-
 * pseudo's: gebruik `isAdminPseudo(regel)` uit `@/lib/orders/admin-pseudo`
 * — niet deze constant.
 *
 * Zie ADR-0018.
 */
export const SHIPPING_PRODUCT_ID = 'VERZEND'
export const SHIPPING_THRESHOLD = 500   // standaard drempel (fallback)
export const SHIPPING_COST = 35         // standaard verzendkosten (fallback)
