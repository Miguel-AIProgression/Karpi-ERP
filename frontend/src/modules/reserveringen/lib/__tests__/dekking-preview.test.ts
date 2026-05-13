import { describe, it, expect } from 'vitest'
import { berekenRegelDekking } from '../dekking-preview'
import { regelDekkingFixtures } from '../fixtures'
import { SHIPPING_PRODUCT_ID } from '@/lib/constants/shipping'

/**
 * Contract-test voor `berekenRegelDekking` (ADR-0015, Ingreep 4).
 *
 * Elke fixture in `regelDekkingFixtures` representeert een (input, expected)-paar
 * dat zowel de TS-spiegel als de SQL-RPC `simuleer_dekking` moet honoreren.
 * Drift tussen de twee adapters wordt hier (TS) en in een toekomstige BE-test
 * (SQL) gevangen — beide draaien identieke fixtures.
 */
describe('berekenRegelDekking — fixture-contract', () => {
  for (const fixture of regelDekkingFixtures) {
    it(fixture.name, () => {
      expect(berekenRegelDekking(fixture.input)).toEqual(fixture.expected)
    })
  }
})

describe('berekenRegelDekking — expliciete edge cases', () => {
  it('handmatige uitwisselbaar > te_leveren wordt geclipt op het tekort', () => {
    // Voorraad dekt al de helft, gebruiker kiest absurd veel uitwisselbaar.
    // De helper moet uitwisselbaar clippen op de resterende behoefte, nooit
    // erboven uitkomen (anders zou de allocator overbookings produceren).
    const result = berekenRegelDekking({
      omschrijving: 'Clip-test',
      orderaantal: 10,
      te_leveren: 10,
      korting_pct: 0,
      artikelnr: 'CLIP-001',
      vrije_voorraad: 4,
      uitwisselbaar_keuzes: [{ artikelnr: 'CLIP-001-EQ', aantal: 999 }],
    })
    expect(result.direct).toBe(4)
    expect(result.uitwisselbaar).toBe(6)
    expect(result.ioTekort).toBe(0)
    expect(result.direct + result.uitwisselbaar + result.ioTekort).toBe(10)
  })

  it(`shipping-product (${SHIPPING_PRODUCT_ID}) → alle takken nul`, () => {
    const result = berekenRegelDekking({
      omschrijving: 'Verzendkosten',
      orderaantal: 1,
      te_leveren: 1,
      korting_pct: 0,
      artikelnr: SHIPPING_PRODUCT_ID,
      is_pseudo: true,  // mig 272 / ADR-0018: admin-pseudo-flag uit producten.is_pseudo
      vrije_voorraad: 999,
      uitwisselbaar_keuzes: [{ artikelnr: 'EQ-VERZEND', aantal: 5 }],
    })
    expect(result).toEqual({ direct: 0, uitwisselbaar: 0, ioTekort: 0 })
  })
})
