/**
 * Standaard tapijtmaten (breedte × lengte in cm) voor de snelkeuze op het
 * product-aanmaak-formulier. Afgeleid uit de werkelijk meest verkochte vaste
 * maten in `producten` (telling 2026-06-15) — meest voorkomend eerst.
 *
 * Conventie: breedte ≤ lengte, zelfde volgorde als de Breedte/Lengte-velden in
 * het formulier. De maat voedt de Karpi-code-suffix `{breedte:3}{lengte:3}`.
 */
export interface StandaardMaat {
  breedte: number
  lengte: number
}

export const STANDAARD_TAPIJTMATEN: StandaardMaat[] = [
  { breedte: 200, lengte: 290 },
  { breedte: 160, lengte: 230 },
  { breedte: 130, lengte: 190 },
  { breedte: 120, lengte: 170 },
  { breedte: 80, lengte: 150 },
  { breedte: 140, lengte: 200 },
  { breedte: 155, lengte: 230 },
  { breedte: 240, lengte: 330 },
  { breedte: 240, lengte: 340 },
  { breedte: 300, lengte: 400 },
  { breedte: 200, lengte: 200 },
  { breedte: 160, lengte: 160 },
]
