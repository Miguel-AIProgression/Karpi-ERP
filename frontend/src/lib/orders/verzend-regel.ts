import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import { SHIPPING_PRODUCT_ID, SHIPPING_THRESHOLD, SHIPPING_COST } from '@/lib/constants/shipping'
import { heeftDropshipRegel } from './dropshipment-regel'

/** Smal contract voor verzend-regel-bepaling — subset van SelectedClient. */
export interface KlantVerzendInfo {
  gratis_verzending: boolean
  verzendkosten: number
  verzend_drempel: number
}

export interface CombiLeveringOptions {
  /** TRUE zolang deze order op zijn Combi-levering-wachtgroep wacht — geen
   *  VERZEND-regel toevoegen, de beslissing wordt uitgesteld tot vrijgave
   *  (ADR-0039). */
  wachtOpCombiLevering: boolean
}

/**
 * Voegt de automatische VERZEND-regel toe, verwijdert hem, of laat hem
 * staan op basis van vijf regels:
 *
 * 0. Dropship-regel aanwezig (flag-based, mig 370) → VERZEND-regel altijd
 *    weg; de dropship-kostenregel ís de verzendcomponent van de order.
 * 1. `afhalen=true` → VERZEND-regel altijd weg; klant haalt zelf op.
 * 1b. Klant wacht op zijn Combi-levering-groep (ADR-0039) → geen VERZEND-
 *     regel; de drempel-beslissing wordt uitgesteld tot vrijgave.
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
  combiLevering: CombiLeveringOptions = { wachtOpCombiLevering: false },
): OrderRegelFormData[] {
  if (heeftDropshipRegel(regels) || afhalen) {
    return regels.filter((l) => l.artikelnr !== SHIPPING_PRODUCT_ID)
  }

  if (combiLevering.wachtOpCombiLevering) {
    // ADR-0039: de drempel-beslissing wordt uitgesteld tot de Combi-levering-
    // groep de drempel haalt (of de klant expliciet overrult) — geen
    // voorlopige VERZEND-regel die later weer verwijderd moet worden.
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
