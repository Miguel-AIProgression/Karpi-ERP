import { describe, expect, it } from 'vitest'
import { bepaalMaatwerkFase, isMaatwerkProductieKlaar } from './maatwerk-productie'

describe('bepaalMaatwerkFase', () => {
  it('geen snijplannen (leeg / null / undefined) → te_plannen', () => {
    expect(bepaalMaatwerkFase([])).toBe('te_plannen')
    expect(bepaalMaatwerkFase(null)).toBe('te_plannen')
    expect(bepaalMaatwerkFase(undefined)).toBe('te_plannen')
  })

  it('mapt elke status naar de juiste fase', () => {
    expect(bepaalMaatwerkFase([{ status: 'Wacht' }])).toBe('te_plannen')
    expect(bepaalMaatwerkFase([{ status: 'Gepland' }])).toBe('op_snijplanning')
    expect(bepaalMaatwerkFase([{ status: 'Snijden' }])).toBe('op_snijplanning')
    expect(bepaalMaatwerkFase([{ status: 'Gesneden' }])).toBe('gesneden')
    expect(bepaalMaatwerkFase([{ status: 'In confectie' }])).toBe('in_afwerking')
    expect(bepaalMaatwerkFase([{ status: 'In productie' }])).toBe('in_afwerking')
    expect(bepaalMaatwerkFase([{ status: 'Gereed' }])).toBe('in_afwerking')
    expect(bepaalMaatwerkFase([{ status: 'Ingepakt' }])).toBe('klaar_voor_verzending')
  })

  it('bij gemengde stuks wint de traagste (minst gevorderde) fase', () => {
    // Ingepakt + Gereed → traagste = in_afwerking (Gereed)
    expect(
      bepaalMaatwerkFase([{ status: 'Ingepakt' }, { status: 'Gereed' }]),
    ).toBe('in_afwerking')
    // Gepland + Gesneden → traagste = op_snijplanning (Gepland)
    expect(
      bepaalMaatwerkFase([{ status: 'Gesneden' }, { status: 'Gepland' }]),
    ).toBe('op_snijplanning')
    // Wacht trekt alles terug naar te_plannen
    expect(
      bepaalMaatwerkFase([{ status: 'Ingepakt' }, { status: 'Wacht' }]),
    ).toBe('te_plannen')
  })

  it('alle stuks ingepakt → klaar_voor_verzending', () => {
    expect(
      bepaalMaatwerkFase([{ status: 'Ingepakt' }, { status: 'Ingepakt' }]),
    ).toBe('klaar_voor_verzending')
  })

  it('geannuleerde snijplannen tellen niet mee', () => {
    // Enige niet-geannuleerde is ingepakt → klaar
    expect(
      bepaalMaatwerkFase([{ status: 'Ingepakt' }, { status: 'Geannuleerd' }]),
    ).toBe('klaar_voor_verzending')
    // Geannuleerd sleept de fase niet omlaag
    expect(
      bepaalMaatwerkFase([{ status: 'Gesneden' }, { status: 'Geannuleerd' }]),
    ).toBe('gesneden')
  })

  it('uitsluitend geannuleerde snijplannen → te_plannen (niets in productie)', () => {
    expect(bepaalMaatwerkFase([{ status: 'Geannuleerd' }])).toBe('te_plannen')
  })
})

describe('isMaatwerkProductieKlaar', () => {
  it('geen snijplannen → niet klaar', () => {
    expect(isMaatwerkProductieKlaar([])).toBe(false)
    expect(isMaatwerkProductieKlaar(null)).toBe(false)
    expect(isMaatwerkProductieKlaar(undefined)).toBe(false)
  })

  it('nog in productie → niet klaar', () => {
    expect(isMaatwerkProductieKlaar([{ status: 'Gepland' }])).toBe(false)
    expect(
      isMaatwerkProductieKlaar([{ status: 'Ingepakt' }, { status: 'Gereed' }]),
    ).toBe(false)
  })

  it('alle stuks ingepakt → klaar', () => {
    expect(isMaatwerkProductieKlaar([{ status: 'Ingepakt' }])).toBe(true)
    expect(
      isMaatwerkProductieKlaar([{ status: 'Ingepakt' }, { status: 'Geannuleerd' }]),
    ).toBe(true)
  })
})
