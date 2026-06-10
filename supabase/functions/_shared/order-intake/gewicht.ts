// Gedeelde gewicht-normalisatie voor de Lightspeed-intake-paden
// (sync-webshop-order webhook + import-lightspeed-orders cron-poll).
//
// Lightspeed eCom levert het regelgewicht als integer in MICRO-kg
// (schaalfactor 1e6): 4210000 → 4.21 kg. Vóór deze helper deelde de
// webhook door 1e6 en de cron-poll door 1e3 — een factor-1000-bug op
// identieke brondata. Eén bron van waarheid lost dat op.
//
// Begrensd op NUMERIC(8,2) (order_regels.gewicht_kg): absurd hoge of
// negatieve waarden → null (medewerker vult dan handmatig aan).
export function kgVanLightspeedGewicht(raw: number | undefined | null): number | null {
  if (raw == null || Number.isNaN(raw)) return null
  const kg = raw / 1_000_000
  if (kg >= 1_000_000 || kg < 0) return null
  return Math.round(kg * 100) / 100
}
