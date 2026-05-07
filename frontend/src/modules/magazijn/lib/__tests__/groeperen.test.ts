import { describe, it, expect } from 'vitest'
import { clusterOrdersOpKlant, groepeerOrdersOpLand } from '../groeperen'
import type { PickShipOrder } from '../types'

function makeOrder(overrides: Partial<PickShipOrder> = {}): PickShipOrder {
  return {
    order_id: 1,
    order_nr: 'ORD-2026-0001',
    status: 'Nieuw',
    klant_naam: 'Klant A',
    debiteur_nr: 100,
    afl_naam: null,
    afl_adres: null,
    afl_postcode: null,
    afl_plaats: null,
    afl_land: 'NL',
    afleverdatum: '2026-05-12',
    afhalen: false,
    bucket: 'wk_1',
    verzend_week_sleutel: '2026-W20',
    verzend_week_label: 'Verzendweek 20',
    verzend_week_kort: 'Wk 20',
    regels: [],
    totaal_m2: 0,
    totaal_gewicht_kg: 0,
    aantal_regels: 0,
    ...overrides,
  }
}

describe('clusterOrdersOpKlant', () => {
  it('clustert opeenvolgende orders met dezelfde debiteur_nr', () => {
    const orders = [
      makeOrder({ order_id: 1, order_nr: 'ORD-001', debiteur_nr: 100, klant_naam: 'Klant A' }),
      makeOrder({ order_id: 2, order_nr: 'ORD-002', debiteur_nr: 100, klant_naam: 'Klant A' }),
      makeOrder({ order_id: 3, order_nr: 'ORD-003', debiteur_nr: 200, klant_naam: 'Klant B' }),
    ]
    const clusters = clusterOrdersOpKlant(orders)
    expect(clusters).toHaveLength(2)
    expect(clusters[0].debiteur_nr).toBe(100)
    expect(clusters[0].orders).toHaveLength(2)
    expect(clusters[1].debiteur_nr).toBe(200)
    expect(clusters[1].orders).toHaveLength(1)
  })

  it('sorteert alfabetisch op klant_naam zodat zelfde-klant orders altijd adjacent zijn', () => {
    const orders = [
      makeOrder({ order_id: 1, order_nr: 'ORD-001', debiteur_nr: 200, klant_naam: 'Beta' }),
      makeOrder({ order_id: 2, order_nr: 'ORD-002', debiteur_nr: 100, klant_naam: 'Alpha' }),
      makeOrder({ order_id: 3, order_nr: 'ORD-003', debiteur_nr: 200, klant_naam: 'Beta' }),
    ]
    const clusters = clusterOrdersOpKlant(orders)
    expect(clusters).toHaveLength(2)
    expect(clusters[0].klant_naam).toBe('Alpha')
    expect(clusters[1].klant_naam).toBe('Beta')
    expect(clusters[1].orders).toHaveLength(2)
  })

  it('sorteert binnen cluster op order_nr', () => {
    const orders = [
      makeOrder({ order_id: 1, order_nr: 'ORD-2026-0099', debiteur_nr: 100, klant_naam: 'Klant A' }),
      makeOrder({ order_id: 2, order_nr: 'ORD-2026-0001', debiteur_nr: 100, klant_naam: 'Klant A' }),
    ]
    const clusters = clusterOrdersOpKlant(orders)
    expect(clusters[0].orders[0].order_nr).toBe('ORD-2026-0001')
    expect(clusters[0].orders[1].order_nr).toBe('ORD-2026-0099')
  })

  it('lege input → lege output', () => {
    expect(clusterOrdersOpKlant([])).toEqual([])
  })
})

describe('groepeerOrdersOpLand', () => {
  it('splitst per ISO-2-land en clustert binnen elk land op klant', () => {
    const orders = [
      makeOrder({ order_id: 1, afl_land: 'NL', debiteur_nr: 100, klant_naam: 'NL Klant' }),
      makeOrder({ order_id: 2, afl_land: 'DE', debiteur_nr: 200, klant_naam: 'DE Klant 1' }),
      makeOrder({ order_id: 3, afl_land: 'DE', debiteur_nr: 200, klant_naam: 'DE Klant 1' }),
      makeOrder({ order_id: 4, afl_land: 'BE', debiteur_nr: 300, klant_naam: 'BE Klant' }),
    ]
    const groepen = groepeerOrdersOpLand(orders)
    // Alfabetisch: BE, DE, NL
    expect(groepen.map((g) => g.iso2)).toEqual(['BE', 'DE', 'NL'])
    expect(groepen[1].clusters).toHaveLength(1) // DE: één klant met 2 orders
    expect(groepen[1].clusters[0].orders).toHaveLength(2)
  })

  it('normaliseert volledige landnamen ("Nederland" → NL)', () => {
    const orders = [
      makeOrder({ order_id: 1, afl_land: 'Nederland' }),
      makeOrder({ order_id: 2, afl_land: 'NL' }),
    ]
    const groepen = groepeerOrdersOpLand(orders)
    expect(groepen).toHaveLength(1)
    expect(groepen[0].iso2).toBe('NL')
    expect(groepen[0].vlag).not.toBeNull()
  })

  it('onbekend land → iso2=null, sorteert achteraan', () => {
    const orders = [
      makeOrder({ order_id: 1, afl_land: 'Marsrepubliek' }),
      makeOrder({ order_id: 2, afl_land: 'NL' }),
    ]
    const groepen = groepeerOrdersOpLand(orders)
    expect(groepen).toHaveLength(2)
    expect(groepen[0].iso2).toBe('NL')
    expect(groepen[1].iso2).toBeNull()
    expect(groepen[1].vlag).toBeNull()
  })
})
