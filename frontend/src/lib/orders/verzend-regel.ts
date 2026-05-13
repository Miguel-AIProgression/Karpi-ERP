import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import { SHIPPING_PRODUCT_ID, SHIPPING_THRESHOLD, SHIPPING_COST } from '@/lib/constants/shipping'

/** Smal contract voor verzend-regel-bepaling — subset van SelectedClient. */
export interface KlantVerzendInfo {
  gratis_verzending: boolean
  verzendkosten: number
  verzend_drempel: number
}

/**
 * Voegt de automatische VERZEND-regel toe, verwijdert hem, of laat hem
 * staan op basis van drie regels:
 *
 * 1. `afhalen=true` → VERZEND-regel altijd weg; klant haalt zelf op.
 * 2. Subtotaal < klant-drempel én klant heeft geen `gratis_verzending` →
 *    VERZEND-regel toevoegen op klant-tarief (of fallback naar constants).
 * 3. Anders → bestaande VERZEND-regel verwijderen.
 *
 * Pure functie — geen state, geen side effects. Hoort thuis in `lib/orders/`
 * naast `verzendweek.ts` en `bundel-sleutel.ts`. Subtotaal wordt berekend
 * over alle regels behalve de bestaande VERZEND-regel zelf, zodat de
 * functie idempotent is bij herhaalde aanroep.
 */
export function applyShippingLogic(
  regels: OrderRegelFormData[],
  client: KlantVerzendInfo | null,
  afhalen: boolean,
): OrderRegelFormData[] {
  if (afhalen) {
    return regels.filter((l) => l.artikelnr !== SHIPPING_PRODUCT_ID)
  }

  const subtotaal = regels
    .filter((l) => l.artikelnr !== SHIPPING_PRODUCT_ID)
    .reduce((sum, l) => sum + (l.bedrag ?? 0), 0)

  const drempel = client?.verzend_drempel ?? SHIPPING_THRESHOLD
  const kosten = client?.verzendkosten ?? SHIPPING_COST
  const needsShipping = subtotaal < drempel && !client?.gratis_verzending
  const hasShippingLine = regels.some((l) => l.artikelnr === SHIPPING_PRODUCT_ID)

  if (needsShipping && !hasShippingLine) {
    const shippingLine: OrderRegelFormData = {
      artikelnr: SHIPPING_PRODUCT_ID,
      omschrijving: 'Verzendkosten',
      orderaantal: 1,
      te_leveren: 1,
      prijs: kosten,
      korting_pct: 0,
      bedrag: kosten,
      // ADR-0018: VERZEND is admin-pseudo (mig 272). Display-only flag zodat
      // isAdminPseudo(regel) in dekking-preview/afleverdatum/etc. werkt.
      is_pseudo: true,
    }
    return [...regels, shippingLine]
  }

  if (!needsShipping && hasShippingLine) {
    return regels.filter((l) => l.artikelnr !== SHIPPING_PRODUCT_ID)
  }

  return regels
}
