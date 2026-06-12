import { describe, it, expect } from 'vitest'
import { applyShippingLogic, type KlantVerzendInfo } from '../verzend-regel'
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'

const klant: KlantVerzendInfo = {
  gratis_verzending: false,
  verzendkosten: 12.5,
  verzend_drempel: 500,
}

const tapijt: OrderRegelFormData = {
  artikelnr: 'ABC123',
  omschrijving: 'Tapijt 200x300',
  orderaantal: 1,
  te_leveren: 1,
  prijs: 100,
  korting_pct: 0,
  bedrag: 100,
}

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

const dropshipKlein: OrderRegelFormData = {
  artikelnr: 'DROPSHIP-KLEIN',
  omschrijving: 'Dropshipment (tapijt t/m 200 cm)',
  orderaantal: 1,
  te_leveren: 1,
  prijs: 35,
  korting_pct: 0,
  bedrag: 35,
  is_pseudo: true,
  is_dropship: true,
}

const heeftVerzend = (regels: OrderRegelFormData[]) =>
  regels.some((r) => r.artikelnr === 'VERZEND')

describe('applyShippingLogic — basisregels', () => {
  it('voegt VERZEND toe onder de klant-drempel', () => {
    const result = applyShippingLogic([tapijt], klant, false)
    expect(heeftVerzend(result)).toBe(true)
    expect(result.find((r) => r.artikelnr === 'VERZEND')!.prijs).toBe(12.5)
  })

  it('voegt géén VERZEND toe bij gratis_verzending', () => {
    const result = applyShippingLogic([tapijt], { ...klant, gratis_verzending: true }, false)
    expect(heeftVerzend(result)).toBe(false)
  })

  it('verwijdert VERZEND boven de drempel', () => {
    const groot: OrderRegelFormData = { ...tapijt, bedrag: 600 }
    const result = applyShippingLogic([groot, verzend], klant, false)
    expect(heeftVerzend(result)).toBe(false)
  })

  it('afhalen verwijdert VERZEND altijd', () => {
    const result = applyShippingLogic([tapijt, verzend], klant, true)
    expect(heeftVerzend(result)).toBe(false)
  })

  it('is idempotent: bestaande VERZEND blijft enkel staan, wordt niet gedupliceerd', () => {
    const result = applyShippingLogic([tapijt, verzend], klant, false)
    expect(result.filter((r) => r.artikelnr === 'VERZEND')).toHaveLength(1)
  })
})

describe('applyShippingLogic — dropship-guard (regel 0)', () => {
  // Een dropship-kostenregel ís de verzendcomponent van de order: VERZEND
  // mag er nooit naast staan, ongeacht drempel of klantinstellingen.
  // Regressie: klantwissel op een dropship-order (handleClientChange reset
  // shippingOverridden) en regel-mutaties in edit-mode voegden VERZEND terug toe.

  it('voegt géén VERZEND toe als een dropship-regel aanwezig is (ook onder drempel)', () => {
    const result = applyShippingLogic([tapijt, dropshipKlein], klant, false)
    expect(heeftVerzend(result)).toBe(false)
    expect(result).toContain(dropshipKlein)
  })

  it('verwijdert een al aanwezige VERZEND-regel naast een dropship-regel', () => {
    const result = applyShippingLogic([tapijt, verzend, dropshipKlein], klant, false)
    expect(heeftVerzend(result)).toBe(false)
  })

  it('guard is flag-based: ook een derde dropship-artikel zonder hardcoded id telt', () => {
    const derde: OrderRegelFormData = {
      ...dropshipKlein,
      artikelnr: 'DROPSHIP-SPOED',
      omschrijving: 'Dropshipment spoed',
    }
    const result = applyShippingLogic([tapijt, derde], klant, false)
    expect(heeftVerzend(result)).toBe(false)
  })

  it('zonder dropship-regel blijft de normale logica gelden (na keuze "nee")', () => {
    // handleDropshipChange 'nee' verwijdert eerst de dropship-regel en roept
    // dán applyShippingLogic aan — de guard mag daar niet in de weg zitten.
    const result = applyShippingLogic([tapijt], klant, false)
    expect(heeftVerzend(result)).toBe(true)
  })
})
