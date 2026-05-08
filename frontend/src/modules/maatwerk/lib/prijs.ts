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
