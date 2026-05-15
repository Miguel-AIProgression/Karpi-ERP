import { describe, it, expect } from 'vitest'
import { mapMatchNaarPrefill, type PoMatchResultaat } from './po-prefill'

const baseMatch: PoMatchResultaat = {
  debiteur: { debiteur_nr: null, zeker: false },
  klant_referentie: '06092093',
  leverdatum_tekst: '29-2026',
  spoed: false,
  afleveradres: { naam: 'MAGAZIJN', adres: 'STRAAT 1', postcode: '2500', plaats: 'LIER', land: 'BE' },
  factuuradres: null,
  regels: [],
}

describe('mapMatchNaarPrefill', () => {
  it('zet klant_referentie altijd in header', () => {
    const p = mapMatchNaarPrefill(baseMatch)
    expect(p.header.klant_referentie).toBe('06092093')
  })

  it('parset leverweek "29-2026" naar week', () => {
    const p = mapMatchNaarPrefill(baseMatch)
    expect(p.header.week).toBe('29')
  })

  it('laat week leeg bij niet-weekteksten', () => {
    const p = mapMatchNaarPrefill({ ...baseMatch, leverdatum_tekst: 'zo snel mogelijk' })
    expect(p.header.week).toBeUndefined()
  })

  it('vult afleveradres als concept (altijd)', () => {
    const p = mapMatchNaarPrefill(baseMatch)
    expect(p.header.afl_plaats).toBe('LIER')
    expect(p.header.afl_land).toBe('BE')
  })

  it('neemt alleen regels met zeker=true over als gematchte regel', () => {
    const m: PoMatchResultaat = {
      ...baseMatch,
      regels: [
        { aantal: 1, ruwe_omschrijving: 'Cavaro 240x330', artikelnr: 'ART1', is_maatwerk: false, maatwerk_kwaliteit_code: null, maatwerk_kleur_code: null, lengte_cm: 240, breedte_cm: 330, vorm_tekst: null, prijs: 100, korting_pct: 0, zeker: true },
        { aantal: 2, ruwe_omschrijving: 'Onbekend', artikelnr: null, is_maatwerk: false, maatwerk_kwaliteit_code: null, maatwerk_kleur_code: null, lengte_cm: null, breedte_cm: null, vorm_tekst: null, prijs: null, korting_pct: null, zeker: false },
      ],
    }
    const p = mapMatchNaarPrefill(m)
    expect(p.regels).toHaveLength(2)
    expect(p.regels[0].artikelnr).toBe('ART1')
    expect(p.regels[1].artikelnr).toBeUndefined()
    expect(p.samenvatting.regelsGematcht).toBe(1)
    expect(p.samenvatting.regelsConcept).toBe(1)
  })

  it('zet maatwerk-velden bij zekere maatwerk-regel', () => {
    const m: PoMatchResultaat = {
      ...baseMatch,
      regels: [{ aantal: 1, ruwe_omschrijving: 'Luxury 450x250', artikelnr: null, is_maatwerk: true, maatwerk_kwaliteit_code: 'LUX', maatwerk_kleur_code: '13', lengte_cm: 450, breedte_cm: 250, vorm_tekst: 'Rechthoekig', prijs: null, korting_pct: null, zeker: true }],
    }
    const p = mapMatchNaarPrefill(m)
    expect(p.regels[0].is_maatwerk).toBe(true)
    expect(p.regels[0].maatwerk_kwaliteit_code).toBe('LUX')
    expect(p.regels[0].maatwerk_lengte_cm).toBe(450)
  })

  it('telt debiteur in samenvatting', () => {
    const p = mapMatchNaarPrefill({ ...baseMatch, debiteur: { debiteur_nr: 280822, zeker: true } })
    expect(p.samenvatting.debiteurZeker).toBe(true)
  })

  it('parset swap-vorm "2026-29" naar week', () => {
    const p = mapMatchNaarPrefill({ ...baseMatch, leverdatum_tekst: 'Leverweek verwacht: 2026-29' })
    expect(p.header.week).toBe('29')
    expect(p.samenvatting.weekBekend).toBe(true)
  })

  it.each([
    ['wk 29', '29'],
    ['week 29', '29'],
    ['leverweek 29 2026', '29'],
    ['week 29/2026', '29'],
    ['05-2026', '5'],
  ])('parset week-context "%s" -> %s', (tekst, verwacht) => {
    expect(mapMatchNaarPrefill({ ...baseMatch, leverdatum_tekst: tekst }).header.week).toBe(verwacht)
  })

  it.each(['2026', '00-2026', '99-2026', 'werk 12', 'zo snel mogelijk', null])(
    'laat week leeg bij %s',
    (tekst) => {
      const p = mapMatchNaarPrefill({ ...baseMatch, leverdatum_tekst: tekst as string | null })
      expect(p.header.week).toBeUndefined()
      expect(p.samenvatting.weekBekend).toBe(false)
    },
  )

  it('vult factuuradres als concept', () => {
    const p = mapMatchNaarPrefill({
      ...baseMatch,
      factuuradres: { naam: 'FACT BV', adres: 'Kade 9', postcode: '1011AB', plaats: 'AMSTERDAM', land: 'NL' },
    })
    expect(p.header.fact_naam).toBe('FACT BV')
    expect(p.header.fact_plaats).toBe('AMSTERDAM')
    expect(p.header.fact_land).toBe('NL')
  })

  it('geeft prijs door op gematchte regel en laat prijs weg bij null', () => {
    const m: PoMatchResultaat = {
      ...baseMatch,
      regels: [
        { aantal: 1, ruwe_omschrijving: 'A', artikelnr: 'ART1', is_maatwerk: false, maatwerk_kwaliteit_code: null, maatwerk_kleur_code: null, lengte_cm: null, breedte_cm: null, vorm_tekst: null, prijs: 100, korting_pct: 7, zeker: true },
        { aantal: 1, ruwe_omschrijving: 'B', artikelnr: null, is_maatwerk: true, maatwerk_kwaliteit_code: 'LUX', maatwerk_kleur_code: '13', lengte_cm: 450, breedte_cm: 250, vorm_tekst: 'Rechthoekig', prijs: null, korting_pct: null, zeker: true },
      ],
    }
    const p = mapMatchNaarPrefill(m)
    expect(p.regels[0].prijs).toBe(100)
    expect(p.regels[0].korting_pct).toBe(7)
    expect('prijs' in p.regels[1]).toBe(false)
    // vorm_tekst wordt bewust niet voorgevuld
    expect((p.regels[1] as Record<string, unknown>).maatwerk_vorm).toBeUndefined()
  })

  it('default aantal null -> 1 en korting null -> 0 op concept-regel', () => {
    const m: PoMatchResultaat = {
      ...baseMatch,
      regels: [{ aantal: null, ruwe_omschrijving: 'X', artikelnr: null, is_maatwerk: false, maatwerk_kwaliteit_code: null, maatwerk_kleur_code: null, lengte_cm: null, breedte_cm: null, vorm_tekst: null, prijs: null, korting_pct: null, zeker: false }],
    }
    const p = mapMatchNaarPrefill(m)
    expect(p.regels[0].orderaantal).toBe(1)
    expect(p.regels[0].te_leveren).toBe(1)
    expect(p.regels[0].korting_pct).toBe(0)
  })

  it('neemt spoed over in samenvatting', () => {
    const p = mapMatchNaarPrefill({ ...baseMatch, spoed: true })
    expect(p.samenvatting.spoed).toBe(true)
  })
})
