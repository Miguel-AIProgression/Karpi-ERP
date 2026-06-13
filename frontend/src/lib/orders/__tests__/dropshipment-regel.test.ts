import { describe, it, expect } from 'vitest'
import {
  isDropshipRegel,
  heeftDropshipRegel,
  detecteerDropshipKeuze,
  applyDropshipmentLogic,
} from '../dropshipment-regel'
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'

describe('isDropshipRegel (flag-based, mig 370 / ADR-0018)', () => {
  it('true voor form-data shape met is_dropship=true top-level', () => {
    expect(isDropshipRegel({ is_dropship: true })).toBe(true)
  })

  it('true voor query-shape met producten.is_dropship=true (join)', () => {
    expect(isDropshipRegel({ producten: { is_dropship: true } })).toBe(true)
  })

  it('herkent een derde dropship-artikel — artikelnr is irrelevant', () => {
    // Pre-fix matchte detectie op DROPSHIP-KLEIN/-GROOT; een nieuw artikel
    // met alleen de DB-vlag moet nu ook gezien worden (kern van dit plan).
    expect(
      isDropshipRegel({ artikelnr: 'DROPSHIP-SPOED', is_dropship: true } as OrderRegelFormData),
    ).toBe(true)
  })

  it('false voor regel zonder vlag (gewoon artikel)', () => {
    expect(isDropshipRegel({ artikelnr: 'ABC123' } as OrderRegelFormData)).toBe(false)
    expect(isDropshipRegel({ producten: { is_dropship: false } })).toBe(false)
    expect(isDropshipRegel({ producten: null })).toBe(false)
  })

  it('false voor null/undefined regel', () => {
    expect(isDropshipRegel(null)).toBe(false)
    expect(isDropshipRegel(undefined)).toBe(false)
  })

  it('false als is_dropship null is (pre-mig-370 rijen)', () => {
    expect(isDropshipRegel({ producten: { is_dropship: null } })).toBe(false)
  })

  it('true zodra één van beide shapes TRUE is (OR, beide richtingen)', () => {
    expect(isDropshipRegel({ is_dropship: false, producten: { is_dropship: true } })).toBe(true)
    expect(isDropshipRegel({ is_dropship: true, producten: { is_dropship: false } })).toBe(true)
  })
})

describe('heeftDropshipRegel (TS-spiegel van SQL is_dropship_order)', () => {
  it('true zodra één regel de vlag draagt', () => {
    expect(
      heeftDropshipRegel([{ artikelnr: 'ABC123' } as OrderRegelFormData, { is_dropship: true }]),
    ).toBe(true)
  })

  it('false voor lege lijst en lijst zonder vlag', () => {
    expect(heeftDropshipRegel([])).toBe(false)
    expect(heeftDropshipRegel([{ artikelnr: 'ABC123' } as OrderRegelFormData])).toBe(false)
  })
})

describe('detecteerDropshipKeuze (selector-state, bewust artikelnr-based)', () => {
  it("herkent 'klein' en 'groot' op artikelnr", () => {
    expect(detecteerDropshipKeuze([{ artikelnr: 'DROPSHIP-KLEIN' }])).toBe('klein')
    expect(detecteerDropshipKeuze([{ artikelnr: 'DROPSHIP-GROOT' }])).toBe('groot')
  })

  it("geeft 'nee' zonder dropship-regels", () => {
    expect(detecteerDropshipKeuze([{ artikelnr: 'ABC123' }])).toBe('nee')
    expect(detecteerDropshipKeuze([])).toBe('nee')
  })

  it("derde dropship-artikel → 'nee' (selector kent alleen klein/groot; detectie loopt via heeftDropshipRegel)", () => {
    expect(detecteerDropshipKeuze([{ artikelnr: 'DROPSHIP-SPOED' }])).toBe('nee')
  })
})

describe('applyDropshipmentLogic', () => {
  // Prijzen komen sinds 2026-06-13 uit producten.verkoopprijs (DropshipPrijzen),
  // niet meer uit hardcoded constanten.
  const PRIJZEN = { klein: 35.0, groot: 47.5 }

  const tapijt: OrderRegelFormData = {
    artikelnr: 'ABC123',
    omschrijving: 'Tapijt 200x300',
    orderaantal: 1,
    te_leveren: 1,
    prijs: 100,
    korting_pct: 0,
    bedrag: 100,
  }

  it("voegt bij 'klein' een regel toe met is_dropship=true én is_pseudo=true", () => {
    const result = applyDropshipmentLogic([tapijt], 'klein', PRIJZEN)
    const dropship = result.find((r) => r.artikelnr === 'DROPSHIP-KLEIN')
    expect(dropship).toBeDefined()
    expect(dropship!.is_dropship).toBe(true)
    expect(dropship!.is_pseudo).toBe(true)
    expect(dropship!.prijs).toBe(35.0)
  })

  it("gebruikt de DB-prijs uit DropshipPrijzen (niet een hardcoded constante)", () => {
    const result = applyDropshipmentLogic([tapijt], 'klein', { klein: 39.95, groot: 49.95 })
    expect(result.find((r) => r.artikelnr === 'DROPSHIP-KLEIN')!.prijs).toBe(39.95)
  })

  it("gooit als prijzen ontbreken voor 'klein'/'groot' (vangnet)", () => {
    expect(() => applyDropshipmentLogic([tapijt], 'klein')).toThrow()
  })

  it("'groot' vervangt een bestaande klein-regel (flag-based verwijdering)", () => {
    const metKlein = applyDropshipmentLogic([tapijt], 'klein', PRIJZEN)
    const result = applyDropshipmentLogic(metKlein, 'groot', PRIJZEN)
    expect(result.some((r) => r.artikelnr === 'DROPSHIP-KLEIN')).toBe(false)
    const groot = result.find((r) => r.artikelnr === 'DROPSHIP-GROOT')
    expect(groot).toBeDefined()
    expect(groot!.prijs).toBe(47.5)
  })

  it("'nee' verwijdert flag-based — ook een derde dropship-artikel zonder hardcoded id", () => {
    const derde: OrderRegelFormData = {
      artikelnr: 'DROPSHIP-SPOED',
      omschrijving: 'Dropshipment spoed',
      orderaantal: 1,
      te_leveren: 1,
      prijs: 60,
      korting_pct: 0,
      bedrag: 60,
      is_pseudo: true,
      is_dropship: true,
    }
    const result = applyDropshipmentLogic([tapijt, derde], 'nee')
    expect(result).toEqual([tapijt])
  })

  it("'nee' laat gewone regels ongemoeid", () => {
    expect(applyDropshipmentLogic([tapijt], 'nee')).toEqual([tapijt])
  })

  it("'klein' verwijdert een bestaande VERZEND-regel (dropship vervangt verzendkosten)", () => {
    const verzend: OrderRegelFormData = {
      artikelnr: 'VERZEND',
      omschrijving: 'Verzendkosten',
      orderaantal: 1,
      te_leveren: 1,
      prijs: 12.5,
      korting_pct: 0,
      bedrag: 12.5,
      is_pseudo: true,
    }
    const result = applyDropshipmentLogic([tapijt, verzend], 'klein', PRIJZEN)
    expect(result.some((r) => r.artikelnr === 'VERZEND')).toBe(false)
    expect(result.some((r) => r.artikelnr === 'DROPSHIP-KLEIN')).toBe(true)
  })
})
