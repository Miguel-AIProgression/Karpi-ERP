import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import { SHIPPING_PRODUCT_ID } from '@/lib/constants/shipping'
import {
  DROPSHIP_KLEIN_ID,
  DROPSHIP_GROOT_ID,
  DROPSHIP_KLEIN_PRIJS,
  DROPSHIP_GROOT_PRIJS,
  type DropshipmentKeuze,
} from '@/lib/constants/dropshipment'

/**
 * Detectie: is deze regel een dropshipment-kostenregel?
 *
 * Bron-van-waarheid: `producten.is_dropship BOOLEAN` (mig 370) — zelfde
 * ADR-0018-patroon als `isAdminPseudo` (admin-pseudo.ts). Nieuw dropship-
 * artikel = `UPDATE producten SET is_dropship=TRUE`, geen code-edit.
 *
 * Twee shapes worden geaccepteerd:
 * 1. Query-resultaten met `producten ( is_dropship )`-join (OrderRegel-mapping).
 * 2. Form-data met `is_dropship` top-level — gestempeld door
 *    `applyDropshipmentLogic` (create) of de order-edit-mapping (edit).
 *
 * LET OP: voor het *toevoegen* van de kostenregel blijven de constants in
 * `constants/dropshipment.ts` de bron (welk artikel, welke prijs) — net als
 * `SHIPPING_PRODUCT_ID` bij verzendregels. Toevoegen ≠ detecteren.
 */
export interface RegelMetDropshipFlag {
  is_dropship?: boolean | null
  producten?: { is_dropship?: boolean | null } | null
}

export function isDropshipRegel(
  regel: RegelMetDropshipFlag | null | undefined,
): boolean {
  if (!regel) return false
  return regel.is_dropship === true || regel.producten?.is_dropship === true
}

/** TS-spiegel van SQL `is_dropship_order(order_id)` (mig 370). */
export function heeftDropshipRegel(regels: RegelMetDropshipFlag[]): boolean {
  return regels.some(isDropshipRegel)
}

/**
 * Detecteert welke selector-stand actief is in de regellijst — bewust
 * artikelnr-gebaseerd: dit voedt uitsluitend de `DropshipmentSelector`-toggle,
 * die alleen de twee bekende keuzes kent. Voor "is dit een dropship-order?"
 * (validatie, banners, e-mail-guard) → `heeftDropshipRegel` (flag-based,
 * ziet óók toekomstige dropship-artikelen).
 */
export function detecteerDropshipKeuze(
  regels: { artikelnr?: string | null }[],
): DropshipmentKeuze {
  if (regels.some((r) => r.artikelnr === DROPSHIP_KLEIN_ID)) return 'klein'
  if (regels.some((r) => r.artikelnr === DROPSHIP_GROOT_ID)) return 'groot'
  return 'nee'
}

/**
 * Past de dropshipment-regel aan op basis van de keuze:
 * - 'nee'   → verwijder alle dropship-regels (flag-based)
 * - 'klein' → verwijder VERZEND + andere dropship-regels, voeg dropship-klein toe
 * - 'groot' → verwijder VERZEND + andere dropship-regels, voeg dropship-groot toe
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
    is_dropship: true,
  }

  return [...zonder, dropshipRegel]
}
