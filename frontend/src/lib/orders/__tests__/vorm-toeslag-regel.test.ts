import { describe, it, expect } from 'vitest'
import {
  isVormToeslagRegel,
  maakVormToeslagRegel,
  syncVormToeslagRegel,
  verwijderRegelMetCompanion,
} from '../vorm-toeslag-regel'
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'

const maatwerkRegel: OrderRegelFormData = {
  artikelnr: 'LIMA14MAATWERK',
  omschrijving: 'Lima 14 - Op maat Ellips 290x200 cm',
  orderaantal: 1,
  te_leveren: 1,
  prijs: 40.6,
  korting_pct: 7,
  bedrag: 37.76,
  is_maatwerk: true,
  maatwerk_vorm: 'ellips',
  maatwerk_vorm_toeslag: 75,
}

describe('isVormToeslagRegel', () => {
  it('true voor artikelnr VORMTOESLAG', () => {
    expect(isVormToeslagRegel({ artikelnr: 'VORMTOESLAG' } as OrderRegelFormData)).toBe(true)
  })

  it('false voor een gewone regel of null/undefined', () => {
    expect(isVormToeslagRegel(maatwerkRegel)).toBe(false)
    expect(isVormToeslagRegel(null)).toBe(false)
    expect(isVormToeslagRegel(undefined)).toBe(false)
  })
})

describe('maakVormToeslagRegel', () => {
  it('bouwt een companion-regel met korting 0, ongeacht de korting van de parent', () => {
    const companion = maakVormToeslagRegel(maatwerkRegel, 'Ellips', 75)
    expect(companion.artikelnr).toBe('VORMTOESLAG')
    expect(companion.korting_pct).toBe(0)
    expect(companion.prijs).toBe(75)
    expect(companion.bedrag).toBe(75)
    expect(companion.is_pseudo).toBe(true)
    expect(companion.is_maatwerk).toBe(false)
    expect(companion.omschrijving).toContain('Ellips')
  })

  it('aantal/te_leveren/bedrag spiegelen het orderaantal van de parent', () => {
    const companion = maakVormToeslagRegel({ ...maatwerkRegel, orderaantal: 3, te_leveren: 3 }, 'Ellips', 75)
    expect(companion.orderaantal).toBe(3)
    expect(companion.te_leveren).toBe(3)
    expect(companion.bedrag).toBe(225)
  })

  it('behoudt het id van een bestaande companion (UPDATE i.p.v. delete+insert)', () => {
    const bestaande: OrderRegelFormData = { ...maakVormToeslagRegel(maatwerkRegel, 'Ellips', 75), id: 42 }
    const companion = maakVormToeslagRegel(maatwerkRegel, 'Ellips', 80, bestaande)
    expect(companion.id).toBe(42)
    expect(companion.prijs).toBe(80)
  })

  it('negeert het id van "bestaande" als die geen vormtoeslag-regel is', () => {
    const anderRegel: OrderRegelFormData = { ...maatwerkRegel, id: 99 }
    const companion = maakVormToeslagRegel(maatwerkRegel, 'Ellips', 75, anderRegel)
    expect(companion.id).toBeUndefined()
  })
})

describe('syncVormToeslagRegel', () => {
  it('voegt een companion toe direct na een maatwerk-regel met vorm-toeslag', () => {
    const result = syncVormToeslagRegel([maatwerkRegel], 0, 'Ellips')
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(maatwerkRegel)
    expect(isVormToeslagRegel(result[1])).toBe(true)
    expect(result[1].prijs).toBe(75)
  })

  it('laat de lijst ongewijzigd als er geen vorm-toeslag is en er ook geen companion bestaat', () => {
    const rechthoek = { ...maatwerkRegel, maatwerk_vorm: 'rechthoek', maatwerk_vorm_toeslag: 0 }
    const result = syncVormToeslagRegel([rechthoek], 0, 'Rechthoek')
    expect(result).toEqual([rechthoek])
  })

  it('verwijdert een bestaande companion zodra de toeslag 0 wordt (vorm gewijzigd naar rechthoek)', () => {
    const companion = maakVormToeslagRegel(maatwerkRegel, 'Ellips', 75)
    const rechthoek = { ...maatwerkRegel, maatwerk_vorm: 'rechthoek', maatwerk_vorm_toeslag: 0 }
    const result = syncVormToeslagRegel([rechthoek, companion], 0, 'Rechthoek')
    expect(result).toEqual([rechthoek])
  })

  it('werkt een bestaande companion bij (nieuwe toeslag/naam) i.p.v. een tweede toe te voegen', () => {
    const companion = maakVormToeslagRegel(maatwerkRegel, 'Ellips', 75)
    const gewijzigd = { ...maatwerkRegel, maatwerk_vorm: 'rond', maatwerk_vorm_toeslag: 50 }
    const result = syncVormToeslagRegel([gewijzigd, companion], 0, 'Rond')
    expect(result).toHaveLength(2)
    expect(result[1].prijs).toBe(50)
    expect(result[1].omschrijving).toContain('Rond')
  })

  it('raakt regels na de companion niet aan', () => {
    const andereRegel: OrderRegelFormData = { ...maatwerkRegel, artikelnr: 'ANDERE', maatwerk_vorm_toeslag: 0 }
    const result = syncVormToeslagRegel([maatwerkRegel, andereRegel], 0, 'Ellips')
    expect(result).toHaveLength(3)
    expect(result[2]).toBe(andereRegel)
  })

  it('doet niets voor een niet-maatwerk regel', () => {
    const normaal: OrderRegelFormData = { artikelnr: 'ABC', omschrijving: 'X', orderaantal: 1, te_leveren: 1, korting_pct: 0 }
    expect(syncVormToeslagRegel([normaal], 0, 'Ellips')).toEqual([normaal])
  })
})

describe('verwijderRegelMetCompanion', () => {
  it('verwijdert de companion mee als de parent verwijderd wordt', () => {
    const companion = maakVormToeslagRegel(maatwerkRegel, 'Ellips', 75)
    const result = verwijderRegelMetCompanion([maatwerkRegel, companion], 0)
    expect(result).toEqual([])
  })

  it('verwijdert alleen de companion zelf, zonder cascade, als die los wordt aangeklikt', () => {
    const companion = maakVormToeslagRegel(maatwerkRegel, 'Ellips', 75)
    const result = verwijderRegelMetCompanion([maatwerkRegel, companion], 1)
    expect(result).toEqual([maatwerkRegel])
  })

  it('laat andere regels intact', () => {
    const andereRegel: OrderRegelFormData = { artikelnr: 'ABC', omschrijving: 'X', orderaantal: 1, te_leveren: 1, korting_pct: 0 }
    const result = verwijderRegelMetCompanion([maatwerkRegel, andereRegel], 0)
    expect(result).toEqual([andereRegel])
  })
})
