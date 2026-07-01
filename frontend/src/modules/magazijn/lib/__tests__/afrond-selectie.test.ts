import { describe, it, expect } from 'vitest'
import { zendingenVoorAfronden } from '../afrond-selectie'
import type { ActievePickronde, PickShipOrder } from '../types'

function makeOrder(overrides: Partial<PickShipOrder> = {}): PickShipOrder {
  return {
    order_id: 1,
    order_nr: 'ORD-2026-0001',
    status: 'In pickronde',
    klant_naam: 'Klant A',
    debiteur_nr: 100,
    afl_naam: null,
    afl_adres: null,
    afl_postcode: null,
    afl_plaats: null,
    afl_land: 'NL',
    afleverdatum: '2026-05-12',
    lever_type: 'week',
    afhalen: false,
    bucket: 'wk_1',
    verzend_week_sleutel: '2026-W20',
    verzend_week_label: 'Verzendweek 20',
    verzend_week_kort: 'Wk 20',
    regels: [],
    totaal_m2: 0,
    totaal_gewicht_kg: 0,
    aantal_regels: 0,
    alle_regels_pickbaar: false,
    heeft_gepland_zending: false,
    afl_adres_incompleet_sinds: null,
    afl_gln_ongekoppeld_sinds: null,
    afl_gln_gecontroleerd_op: null,
    prijs_ontbreekt_sinds: null,
    actieve_pickronde: null,
    ...overrides,
  }
}

function ronde(zendingId: number, zendingNr: string): ActievePickronde {
  return { zending_id: zendingId, zending_nr: zendingNr, picker_id: null, picker_naam: null }
}

describe('zendingenVoorAfronden', () => {
  it('mapt elke order met lopende pickronde naar zijn zending', () => {
    const orders = [
      makeOrder({ order_id: 1, actieve_pickronde: ronde(10, 'ZEND-0010') }),
      makeOrder({ order_id: 2, actieve_pickronde: ronde(11, 'ZEND-0011') }),
    ]
    const result = zendingenVoorAfronden(orders)
    expect(result).toHaveLength(2)
    expect(result.map((z) => z.zending_id).sort()).toEqual([10, 11])
  })

  it('dedupliceert een bundel-zending die bij meerdere orders hoort', () => {
    // Twee orders delen dezelfde bundel-zending → één afronding.
    const orders = [
      makeOrder({ order_id: 1, actieve_pickronde: ronde(10, 'ZEND-0010') }),
      makeOrder({ order_id: 2, actieve_pickronde: ronde(10, 'ZEND-0010') }),
      makeOrder({ order_id: 3, actieve_pickronde: ronde(12, 'ZEND-0012') }),
    ]
    const result = zendingenVoorAfronden(orders)
    expect(result).toHaveLength(2)
    expect(result.map((z) => z.zending_id).sort()).toEqual([10, 12])
    expect(result.find((z) => z.zending_id === 10)?.zending_nr).toBe('ZEND-0010')
  })

  it('negeert orders zonder lopende pickronde', () => {
    const orders = [
      makeOrder({ order_id: 1, actieve_pickronde: null }),
      makeOrder({ order_id: 2, actieve_pickronde: ronde(10, 'ZEND-0010') }),
    ]
    const result = zendingenVoorAfronden(orders)
    expect(result).toEqual([{ zending_id: 10, zending_nr: 'ZEND-0010' }])
  })

  it('geeft een lege lijst voor een lege selectie', () => {
    expect(zendingenVoorAfronden([])).toEqual([])
  })
})
