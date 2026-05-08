/**
 * Bereken het PRIJS-oppervlak in m² (= materiaalverbruik).
 * Rond = diameter² (omsluitend vierkant, industrie-standaard).
 */
export function berekenPrijsOppervlakM2(
  vorm: string,
  lengteCm?: number,
  breedteCm?: number,
  diameterCm?: number
): number {
  if (vorm === 'rond' && diameterCm) {
    return (diameterCm * diameterCm) / 10000
  }
  if (lengteCm && breedteCm) {
    return (lengteCm * breedteCm) / 10000
  }
  return 0
}

/**
 * Bereken de omtrek in strekkende meters voor afwerking-tarief (mig 193).
 * Rechthoek-achtig = 2 × (L+B) / 100 (bv. 200×300 → 10 m).
 * Rond = π × diameter / 100.
 */
export function berekenOmtrekMeter(
  vorm: string,
  lengteCm?: number,
  breedteCm?: number,
  diameterCm?: number
): number {
  if (vorm === 'rond' && diameterCm) {
    return (Math.PI * diameterCm) / 100
  }
  if (lengteCm && breedteCm) {
    return (2 * (lengteCm + breedteCm)) / 100
  }
  return 0
}
