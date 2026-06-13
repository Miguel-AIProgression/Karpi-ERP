import { describe, it, expect } from 'vitest'
import {
  isAfleveradresIncompleet,
  isAfleveradresCompleet,
  ontbrekendeAfleveradresVelden,
} from '../afleveradres-gate'

describe('isAfleveradresIncompleet', () => {
  it('is true als de gate-timestamp gezet is en de order niet in eindstatus zit', () => {
    expect(
      isAfleveradresIncompleet({ afl_adres_incompleet_sinds: '2026-06-13T10:00:00Z', status: 'Nieuw' }),
    ).toBe(true)
  })

  it('is false als de gate-timestamp NULL is (adres compleet)', () => {
    expect(isAfleveradresIncompleet({ afl_adres_incompleet_sinds: null, status: 'Nieuw' })).toBe(false)
  })

  it('is false in eindstatussen, ook met gezette timestamp', () => {
    expect(
      isAfleveradresIncompleet({ afl_adres_incompleet_sinds: '2026-06-13T10:00:00Z', status: 'Verzonden' }),
    ).toBe(false)
    expect(
      isAfleveradresIncompleet({ afl_adres_incompleet_sinds: '2026-06-13T10:00:00Z', status: 'Geannuleerd' }),
    ).toBe(false)
  })
})

describe('isAfleveradresCompleet', () => {
  const compleet = {
    afl_naam: 'Hans van den Hurk',
    afl_adres: 'Hoofdstraat 1',
    afl_postcode: '7122 LB',
    afl_plaats: 'Aalten',
  }

  it('is true als naam + adres + postcode + plaats gevuld zijn', () => {
    expect(isAfleveradresCompleet(compleet)).toBe(true)
  })

  it('is false zodra één verplicht veld leeg of whitespace is', () => {
    expect(isAfleveradresCompleet({ ...compleet, afl_plaats: '' })).toBe(false)
    expect(isAfleveradresCompleet({ ...compleet, afl_adres: '   ' })).toBe(false)
    expect(isAfleveradresCompleet({ ...compleet, afl_naam: null })).toBe(false)
  })

  it('is altijd true voor afhaal-orders, ook zonder adres', () => {
    expect(isAfleveradresCompleet({}, true)).toBe(true)
  })
})

describe('ontbrekendeAfleveradresVelden', () => {
  it('benoemt precies de lege velden', () => {
    expect(
      ontbrekendeAfleveradresVelden({ afl_naam: 'X', afl_adres: '', afl_postcode: '1234', afl_plaats: '' }),
    ).toEqual(['adres', 'plaats'])
  })

  it('geeft een lege lijst bij een compleet adres', () => {
    expect(
      ontbrekendeAfleveradresVelden({
        afl_naam: 'X',
        afl_adres: 'Y 1',
        afl_postcode: '1234 AB',
        afl_plaats: 'Z',
      }),
    ).toEqual([])
  })
})
