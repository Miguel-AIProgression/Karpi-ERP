import { round2 } from '@/lib/utils/formatters'

/**
 * Eén bron voor het regelbedrag: prijs × aantal × (1 − korting%), afgerond op
 * centen. Vervangt de losse kopieën in order-line-editor, split-order en
 * pricing-helper (drift-eliminatie op het geld-pad).
 */
export function berekenRegelBedrag(prijs: number, aantal: number, kortingPct = 0): number {
  return round2(prijs * aantal * (1 - kortingPct / 100))
}
