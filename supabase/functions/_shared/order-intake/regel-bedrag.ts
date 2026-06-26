/**
 * Eén bron voor het intake-regelbedrag: prijs × aantal × (1 - korting/100),
 * afgerond op centen. Null als de prijs ontbreekt.
 * Gedeeld door de Lightspeed- en Shopify-intake.
 */
export function regelBedrag(
  prijs: number | null,
  aantal: number,
  kortingPct: number = 0,
): number | null {
  if (prijs == null) return null
  return Math.round(prijs * aantal * (1 - kortingPct / 100) * 100) / 100
}
