import { SHIPPING_PRODUCT_ID } from '@/lib/constants/shipping'
import type { ZendingPrintRegel } from '../queries/zendingen'

/**
 * Predicate: is dit een verzendkosten-regel die op pakbon/sticker overgeslagen
 * moet worden? Verzendkosten zijn een factuurregel, geen fysiek collo.
 *
 * We checken zowel `zending_regels.artikelnr` (gevuld in pre-mig 206 zendingen)
 * als de gekoppelde `order_regels.artikelnr` (fallback voor oude zendingen waar
 * de `zending_regels.artikelnr`-snapshot ooit leeg is gebleven). Sinds mig 206
 * bestaan VERZEND-regels überhaupt niet meer in nieuwe zendingen, maar
 * historische data moet alsnog correct gerenderd worden.
 *
 * SCOPE (ADR-0018): dit predikaat checkt SPECIFIEK de VERZEND-zending-regel —
 * niet alle admin-pseudo's. BUNDELKORTING en DREMPELKORTING bestaan niet op
 * zending-regels (factuur-only sinds mig 262). Voor generieke admin-pseudo-
 * skip op orderregels: gebruik `isAdminPseudo(regel)` uit
 * `@/lib/orders/admin-pseudo`.
 */
export function isShippingRegel(regel: ZendingPrintRegel): boolean {
  if (regel.artikelnr === SHIPPING_PRODUCT_ID) return true
  if (regel.order_regels?.artikelnr === SHIPPING_PRODUCT_ID) return true
  return false
}
