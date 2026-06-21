/**
 * Eén bron voor het intake-regelbedrag: prijs × aantal afgerond op centen,
 * null als de prijs ontbreekt. Gedeeld door de Lightspeed- en Shopify-intake.
 */
export function regelBedrag(prijs: number | null, aantal: number): number | null {
  return prijs != null ? Math.round(prijs * aantal * 100) / 100 : null
}
