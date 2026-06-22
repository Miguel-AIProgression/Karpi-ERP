import { round2 } from '@/lib/utils/formatters'

/**
 * Bereken de totaalprijs die een op-maat stuk de klant kost — als preview
 * vóór de regel-split. De vorm-toeslag wordt sinds mig 465 een eigen
 * orderregel met korting_pct=0 (frontend/src/lib/orders/vorm-toeslag-regel.ts),
 * dus de korting% geldt alleen voor het m²-bedrag + afwerking; de toeslag
 * komt er ná de korting onverkort bovenop.
 */
export function berekenMaatwerkPrijs(params: {
  oppervlakM2: number
  m2Prijs: number
  vormToeslag: number
  afwerkingPrijs: number
  korting_pct: number
}): number {
  const { oppervlakM2, m2Prijs, vormToeslag, afwerkingPrijs, korting_pct } = params
  const basis = oppervlakM2 * m2Prijs + afwerkingPrijs
  const netto = basis * (1 - korting_pct / 100)
  return round2(netto + vormToeslag)
}
