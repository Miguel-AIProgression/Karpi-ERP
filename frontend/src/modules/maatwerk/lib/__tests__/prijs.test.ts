import { describe, it, expect } from 'vitest'
import { berekenMaatwerkPrijs } from '../prijs'

describe('berekenMaatwerkPrijs (mig 465 — korting niet over vorm-toeslag)', () => {
  it('past korting% alleen toe op m²-bedrag + afwerking, vorm-toeslag komt er onverkort bovenop', () => {
    // 5,80 m² x €7,00/m² = €40,60; +€0 afwerking; 7% korting; +€75 vorm-toeslag
    const totaal = berekenMaatwerkPrijs({
      oppervlakM2: 5.8,
      m2Prijs: 7,
      vormToeslag: 75,
      afwerkingPrijs: 0,
      korting_pct: 7,
    })
    expect(totaal).toBe(Math.round((40.6 * 0.93 + 75) * 100) / 100)
  })

  it('zonder vorm-toeslag is het gedrag ongewijzigd (korting over basis + afwerking)', () => {
    const totaal = berekenMaatwerkPrijs({
      oppervlakM2: 2,
      m2Prijs: 10,
      vormToeslag: 0,
      afwerkingPrijs: 5,
      korting_pct: 10,
    })
    expect(totaal).toBe(22.5) // (20 + 5) * 0.9
  })

  it('zonder korting telt de vorm-toeslag gewoon mee in het totaal', () => {
    const totaal = berekenMaatwerkPrijs({
      oppervlakM2: 2,
      m2Prijs: 10,
      vormToeslag: 75,
      afwerkingPrijs: 0,
      korting_pct: 0,
    })
    expect(totaal).toBe(95)
  })
})
