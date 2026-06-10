import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import { SHIPPING_PRODUCT_ID } from '@/lib/constants/shipping'
import {
  DROPSHIP_KLEIN_ID,
  DROPSHIP_GROOT_ID,
  DROPSHIP_KLEIN_PRIJS,
  DROPSHIP_GROOT_PRIJS,
  type DropshipmentKeuze,
} from '@/lib/constants/dropshipment'

export const DROPSHIP_IDS = [DROPSHIP_KLEIN_ID, DROPSHIP_GROOT_ID] as const

export function isDropshipRegel(r: OrderRegelFormData): boolean {
  return r.artikelnr === DROPSHIP_KLEIN_ID || r.artikelnr === DROPSHIP_GROOT_ID
}

/** Detecteert de huidige dropshipment-keuze uit de regellijst. */
export function detecteerDropshipKeuze(regels: OrderRegelFormData[]): DropshipmentKeuze {
  if (regels.some((r) => r.artikelnr === DROPSHIP_KLEIN_ID)) return 'klein'
  if (regels.some((r) => r.artikelnr === DROPSHIP_GROOT_ID)) return 'groot'
  return 'nee'
}

/**
 * Past de dropshipment-regel aan op basis van de keuze:
 * - 'nee'   → verwijder alle dropship-regels, herstel VERZEND indien nodig
 * - 'klein' → verwijder VERZEND + dropship-groot, voeg dropship-klein toe
 * - 'groot' → verwijder VERZEND + dropship-klein, voeg dropship-groot toe
 *
 * Pure functie — geen side effects.
 */
export function applyDropshipmentLogic(
  regels: OrderRegelFormData[],
  keuze: DropshipmentKeuze,
): OrderRegelFormData[] {
  const zonder = regels.filter((r) => !isDropshipRegel(r) && r.artikelnr !== SHIPPING_PRODUCT_ID)

  if (keuze === 'nee') {
    return regels.filter((r) => !isDropshipRegel(r))
  }

  const artikelnr = keuze === 'klein' ? DROPSHIP_KLEIN_ID : DROPSHIP_GROOT_ID
  const prijs = keuze === 'klein' ? DROPSHIP_KLEIN_PRIJS : DROPSHIP_GROOT_PRIJS
  const omschrijving =
    keuze === 'klein' ? 'Dropshipment (tapijt t/m 200 cm)' : 'Dropshipment (tapijt vanaf 200 cm)'

  const dropshipRegel: OrderRegelFormData = {
    artikelnr,
    omschrijving,
    orderaantal: 1,
    te_leveren: 1,
    prijs,
    korting_pct: 0,
    bedrag: prijs,
    is_pseudo: true,
  }

  return [...zonder, dropshipRegel]
}
