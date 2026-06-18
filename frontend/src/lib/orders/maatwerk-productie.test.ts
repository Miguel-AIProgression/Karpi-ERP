import { describe, expect, it } from 'vitest'
import { isMaatwerkProductieKlaar } from './maatwerk-productie'

describe('isMaatwerkProductieKlaar', () => {
  it('geen snijplannen (leeg / null / undefined) → niet klaar', () => {
    expect(isMaatwerkProductieKlaar([])).toBe(false)
    expect(isMaatwerkProductieKlaar(null)).toBe(false)
    expect(isMaatwerkProductieKlaar(undefined)).toBe(false)
  })

  it('alles nog in productie → niet klaar', () => {
    expect(isMaatwerkProductieKlaar([{ status: 'Wacht' }])).toBe(false)
    expect(isMaatwerkProductieKlaar([{ status: 'Gepland' }])).toBe(false)
    expect(
      isMaatwerkProductieKlaar([{ status: 'Snijden' }, { status: 'In confectie' }]),
    ).toBe(false)
    expect(isMaatwerkProductieKlaar([{ status: 'Gereed' }])).toBe(false)
  })

  it('deels ingepakt → niet klaar (pas vol getal als álles ingepakt is)', () => {
    expect(
      isMaatwerkProductieKlaar([{ status: 'Ingepakt' }, { status: 'Gereed' }]),
    ).toBe(false)
  })

  it('alle stuks ingepakt → klaar', () => {
    expect(isMaatwerkProductieKlaar([{ status: 'Ingepakt' }])).toBe(true)
    expect(
      isMaatwerkProductieKlaar([{ status: 'Ingepakt' }, { status: 'Ingepakt' }]),
    ).toBe(true)
  })

  it('geannuleerde snijplannen tellen niet mee', () => {
    // Alle niet-geannuleerde zijn ingepakt → klaar.
    expect(
      isMaatwerkProductieKlaar([{ status: 'Ingepakt' }, { status: 'Geannuleerd' }]),
    ).toBe(true)
    // Enige overgebleven stuk staat nog in productie → niet klaar.
    expect(
      isMaatwerkProductieKlaar([{ status: 'Gepland' }, { status: 'Geannuleerd' }]),
    ).toBe(false)
  })

  it('uitsluitend geannuleerde snijplannen → niet klaar', () => {
    expect(isMaatwerkProductieKlaar([{ status: 'Geannuleerd' }])).toBe(false)
  })
})
