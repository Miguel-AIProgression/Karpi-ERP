import { describe, it, expect } from 'vitest'
import {
  bepaalStartbaarheid,
  heeftGeenVervoerder,
  type StartbaarheidInput,
  type StartStatus,
} from './startbaarheid'

// Volledig-startbare basis; elke test zet precies de velden die de bedoelde
// status forceren. Default = niets aan de hand → 'startbaar'.
function input(overrides: Partial<StartbaarheidInput> = {}): StartbaarheidInput {
  return {
    order_id: 1,
    afhalen: false,
    alle_regels_pickbaar: true,
    heeft_gepland_zending: false,
    afl_adres_incompleet_sinds: null,
    afl_gln_ongekoppeld_sinds: null,
    afl_gln_gecontroleerd_op: null,
    prijs_ontbreekt_sinds: null,
    in_pickronde: false,
    geen_vervoerder: false,
    ...overrides,
  }
}

function status(overrides: Partial<StartbaarheidInput> = {}): StartStatus {
  return bepaalStartbaarheid(input(overrides)).status
}

describe('bepaalStartbaarheid — één status per order', () => {
  it('geen blokkades → startbaar', () => {
    expect(status()).toBe('startbaar')
  })

  it('afhaal-order zonder blokkades → startbaar (afhalen blokkeert niet)', () => {
    expect(status({ afhalen: true })).toBe('startbaar')
  })

  it('lopende pickronde → in_pickronde', () => {
    expect(status({ in_pickronde: true })).toBe('in_pickronde')
  })

  it('niet alle regels pickbaar → niet_pickbaar', () => {
    expect(status({ alle_regels_pickbaar: false })).toBe('niet_pickbaar')
  })

  it('mig 479: niet alle regels pickbaar, maar wél een Gepland-deelzending → startbaar', () => {
    // start_pickronden promoot dan alleen de Gepland-zending en laat de
    // nog-niet-pickbare regel(s) ongemoeid liggen — de knop mag dus aan.
    expect(
      status({ alle_regels_pickbaar: false, heeft_gepland_zending: true }),
    ).toBe('startbaar')
  })

  it('afleveradres onvolledig → afl_adres', () => {
    expect(status({ afl_adres_incompleet_sinds: '2026-06-18T10:00:00Z' })).toBe('afl_adres')
  })

  it('aflever-GLN niet gekoppeld → afl_gln', () => {
    expect(status({ afl_gln_ongekoppeld_sinds: '2026-06-30T10:00:00Z' })).toBe('afl_gln')
  })

  it('mig 535: GLN ongekoppeld maar bewust vrijgegeven → niet geblokkeerd', () => {
    expect(
      status({
        afl_gln_ongekoppeld_sinds: '2026-06-30T10:00:00Z',
        afl_gln_gecontroleerd_op: '2026-06-30T11:00:00Z',
      }),
    ).toBe('startbaar')
  })

  it('prijs ontbreekt → prijs', () => {
    expect(status({ prijs_ontbreekt_sinds: '2026-06-18T10:00:00Z' })).toBe('prijs')
  })

  it('geen effectieve vervoerder → geen_vervoerder', () => {
    expect(status({ geen_vervoerder: true })).toBe('geen_vervoerder')
  })

  it('behoudt order_id in het resultaat', () => {
    expect(bepaalStartbaarheid(input({ order_id: 4242 })).order_id).toBe(4242)
  })
})

describe('bepaalStartbaarheid — canonieke prioriteit (eerste match wint)', () => {
  // in_pickronde > niet_pickbaar > afl_adres > prijs > geen_vervoerder > startbaar

  it('in_pickronde wint van álles', () => {
    expect(
      status({
        in_pickronde: true,
        alle_regels_pickbaar: false,
        afl_adres_incompleet_sinds: 'x',
        prijs_ontbreekt_sinds: 'x',
        geen_vervoerder: true,
      }),
    ).toBe('in_pickronde')
  })

  it('niet_pickbaar wint van de intake-/vervoerder-gates (isPickbaar-guard)', () => {
    expect(
      status({
        alle_regels_pickbaar: false,
        afl_adres_incompleet_sinds: 'x',
        prijs_ontbreekt_sinds: 'x',
        geen_vervoerder: true,
      }),
    ).toBe('niet_pickbaar')
  })

  it('mig 479: heeft_gepland_zending tilt niet_pickbaar op, maar de lagere gates blijven gelden', () => {
    expect(
      status({
        alle_regels_pickbaar: false,
        heeft_gepland_zending: true,
        afl_adres_incompleet_sinds: 'x',
      }),
    ).toBe('afl_adres')
  })

  it('afl_adres wint van prijs (mig 395/396-volgorde)', () => {
    expect(
      status({ afl_adres_incompleet_sinds: 'x', prijs_ontbreekt_sinds: 'x' }),
    ).toBe('afl_adres')
  })

  it('prijs wint van geen_vervoerder', () => {
    expect(status({ prijs_ontbreekt_sinds: 'x', geen_vervoerder: true })).toBe('prijs')
  })

  it('geen_vervoerder is de laagste blokkade: alleen als hij de énige blocker is', () => {
    // Verder volledig startbaar, alleen geen vervoerder → geen_vervoerder.
    expect(status({ geen_vervoerder: true })).toBe('geen_vervoerder')
    // Zodra er een hogere blocker bij komt, verdwijnt geen_vervoerder uit beeld.
    expect(status({ geen_vervoerder: true, afl_adres_incompleet_sinds: 'x' })).toBe('afl_adres')
  })
})

describe('heeftGeenVervoerder', () => {
  it('afhaal-order → nooit geen_vervoerder (ook niet met bron=geen)', () => {
    expect(heeftGeenVervoerder(true, [{ bron: 'geen' }])).toBe(false)
  })

  it('niet-afhaal met ≥1 regel bron=geen → true', () => {
    expect(heeftGeenVervoerder(false, [{ bron: 'regel' }, { bron: 'geen' }])).toBe(true)
  })

  it('niet-afhaal met alle regels een vervoerder → false', () => {
    expect(heeftGeenVervoerder(false, [{ bron: 'regel' }, { bron: 'override' }])).toBe(false)
  })

  it('resolutie nog niet geladen (undefined) → (nog) geen blokkade', () => {
    expect(heeftGeenVervoerder(false, undefined)).toBe(false)
  })

  it('lege regel-lijst → geen blokkade', () => {
    expect(heeftGeenVervoerder(false, [])).toBe(false)
  })
})
