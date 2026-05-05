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

/** Bereken totaalprijs voor een op-maat orderregel */
export function berekenMaatwerkPrijs(params: {
  oppervlakM2: number
  m2Prijs: number
  vormToeslag: number
  afwerkingPrijs: number
  korting_pct: number
}): number {
  const { oppervlakM2, m2Prijs, vormToeslag, afwerkingPrijs, korting_pct } = params
  const basis = oppervlakM2 * m2Prijs
  const subtotaal = basis + vormToeslag + afwerkingPrijs
  const netto = subtotaal * (1 - korting_pct / 100)
  return Math.round(netto * 100) / 100
}

/** Bereken gewicht op basis van oppervlak en gewicht/m² */
export function berekenMaatwerkGewicht(oppervlakM2: number, gewichtPerM2Kg: number | null): number | undefined {
  if (!gewichtPerM2Kg || oppervlakM2 <= 0) return undefined
  return Math.round(oppervlakM2 * gewichtPerM2Kg * 100) / 100
}
