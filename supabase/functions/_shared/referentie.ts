/**
 * Strips the internal " / Shopify: #NNN" suffix from `orders.klant_referentie`.
 *
 * Shopify orders store a combined value — customer's own PO reference + the
 * Shopify order number — so operators can see the Shopify number inline in the
 * system without needing to navigate to the EDI/webhook log. The Shopify part
 * is purely internal and must not appear on any external document (pakbon,
 * factuur, orderbevestiging, EDI messages, transport labels).
 *
 * Examples:
 *   "16260114290 / Shopify: #5590"  →  "16260114290"
 *   "GOOSSEN / Shopify: #5591"      →  "GOOSSEN"
 *   "Shopify: #5592"                →  null  (no customer ref, nothing to show)
 *   "PO-1234"                       →  "PO-1234"  (unchanged)
 *   null / ""                       →  null
 */
export function externReferentie(ref: string | null | undefined): string | null {
  if (!ref) return null
  const idx = ref.indexOf(' / Shopify: ')
  const result = idx >= 0 ? ref.slice(0, idx).trim() : ref
  return result || null
}
