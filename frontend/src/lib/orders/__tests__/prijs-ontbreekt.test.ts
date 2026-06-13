import { describe, it, expect } from 'vitest'
import { isPrijsOntbreekt } from '../prijs-ontbreekt'

describe('isPrijsOntbreekt', () => {
  it('is true als de gate-timestamp gezet is en de order niet in eindstatus zit', () => {
    expect(
      isPrijsOntbreekt({ prijs_ontbreekt_sinds: '2026-06-13T10:00:00Z', status: 'Nieuw' }),
    ).toBe(true)
  })

  it('is false als de gate-timestamp NULL is (geen ontbrekende prijs / bevestigd)', () => {
    expect(isPrijsOntbreekt({ prijs_ontbreekt_sinds: null, status: 'Nieuw' })).toBe(false)
    expect(isPrijsOntbreekt({})).toBe(false)
  })

  it('is false in eindstatussen, ook met gezette timestamp', () => {
    expect(
      isPrijsOntbreekt({ prijs_ontbreekt_sinds: '2026-06-13T10:00:00Z', status: 'Verzonden' }),
    ).toBe(false)
    expect(
      isPrijsOntbreekt({ prijs_ontbreekt_sinds: '2026-06-13T10:00:00Z', status: 'Geannuleerd' }),
    ).toBe(false)
  })
})
