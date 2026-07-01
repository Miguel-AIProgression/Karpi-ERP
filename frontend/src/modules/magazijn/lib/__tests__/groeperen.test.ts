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

describe('clusterOrdersOpKlant', () => {
  it('clustert orders die dezelfde bundel-sleutel delen', () => {
    const orders = [
      makeOrder({ order_id: 1, order_nr: 'ORD-001', debiteur_nr: 100, klant_naam: 'Klant A' }),
      makeOrder({ order_id: 2, order_nr: 'ORD-002', debiteur_nr: 100, klant_naam: 'Klant A' }),
      makeOrder({ order_id: 3, order_nr: 'ORD-003', debiteur_nr: 200, klant_naam: 'Klant B' }),
    ]
    const sleutel = new Map<number, string>([
      [1, 'D100|VVERH|W2026-W20|Aabc'],
      [2, 'D100|VVERH|W2026-W20|Aabc'],
      [3, 'D200|VHST|W2026-W20|Axyz'],
    ])
    const clusters = clusterOrdersOpKlant(orders, sleutel)
    expect(clusters).toHaveLength(2)
    expect(clusters[0].debiteur_nr).toBe(100)
    expect(clusters[0].orders).toHaveLength(2)
    expect(clusters[1].debiteur_nr).toBe(200)
    expect(clusters[1].orders).toHaveLength(1)
  })

  it('splitst zelfde-klant orders met verschillende bundel-sleutels in losse clusters', () => {
    // Twee FLOORPASSION-orders met verschillende vervoerders → 2 bundels →
    // 2 visuele clusters (geen gezamenlijke BUNDEL-header).
    const orders = [
      makeOrder({ order_id: 1, order_nr: 'ORD-2046', debiteur_nr: 100, klant_naam: 'FLOORPASSION' }),
      makeOrder({ order_id: 2, order_nr: 'ORD-2048', debiteur_nr: 100, klant_naam: 'FLOORPASSION' }),
    ]
    const sleutel = new Map<number, string>([
      [1, 'D100|VVERH|W2026-W20|Aabc'],
      [2, 'D100|VHST|W2026-W20|Aabc'],
    ])
    const clusters = clusterOrdersOpKlant(orders, sleutel)
    expect(clusters).toHaveLength(2)
    expect(clusters[0].orders).toHaveLength(1)
    expect(clusters[1].orders).toHaveLength(1)
  })

  it('zonder bundel-map valt elke order in een eigen solo-cluster', () => {
    const orders = [
      makeOrder({ order_id: 1, order_nr: 'ORD-001', debiteur_nr: 100, klant_naam: 'Klant A' }),
      makeOrder({ order_id: 2, order_nr: 'ORD-002', debiteur_nr: 100, klant_naam: 'Klant A' }),
    ]
    const clusters = clusterOrdersOpKlant(orders)
    expect(clusters).toHaveLength(2)
    expect(clusters[0].orders).toHaveLength(1)
    expect(clusters[1].orders).toHaveLength(1)
  })

  it('orders zonder bundel-entry krijgen een solo-cluster, andere bundelen wel', () => {
    const orders = [
      makeOrder({ order_id: 1, order_nr: 'ORD-001', debiteur_nr: 100, klant_naam: 'Klant A' }),
      makeOrder({ order_id: 2, order_nr: 'ORD-002', debiteur_nr: 100, klant_naam: 'Klant A' }),
      makeOrder({ order_id: 3, order_nr: 'ORD-003', debiteur_nr: 100, klant_naam: 'Klant A' }),
    ]
    const sleutel = new Map<number, string>([
      [1, 'D100|VVERH|W2026-W20|Aabc'],
      [2, 'D100|VVERH|W2026-W20|Aabc'],
      // order 3 mist (bv. geen afleverdatum) → solo-fallback.
    ])
    const clusters = clusterOrdersOpKlant(orders, sleutel)
    expect(clusters).toHaveLength(2)
    expect(clusters[0].orders.map((o) => o.order_id)).toEqual([1, 2])
    expect(clusters[1].orders.map((o) => o.order_id)).toEqual([3])
  })

  it('sorteert alfabetisch op klant_naam zodat zelfde-klant clusters adjacent zijn', () => {
    const orders = [
      makeOrder({ order_id: 1, order_nr: 'ORD-001', debiteur_nr: 200, klant_naam: 'Beta' }),
      makeOrder({ order_id: 2, order_nr: 'ORD-002', debiteur_nr: 100, klant_naam: 'Alpha' }),
      makeOrder({ order_id: 3, order_nr: 'ORD-003', debiteur_nr: 200, klant_naam: 'Beta' }),
    ]
    const sleutel = new Map<number, string>([
      [1, 'D200|VVERH|W2026-W20|Axyz'],
      [3, 'D200|VVERH|W2026-W20|Axyz'],
      [2, 'D100|VHST|W2026-W20|Aabc'],
    ])
    const clusters = clusterOrdersOpKlant(orders, sleutel)
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
    const sleutel = new Map<number, string>([
      [1, 'D100|VVERH|W2026-W20|Aabc'],
      [2, 'D100|VVERH|W2026-W20|Aabc'],
    ])
    const clusters = clusterOrdersOpKlant(orders, sleutel)
    expect(clusters[0].orders[0].order_nr).toBe('ORD-2026-0001')
    expect(clusters[0].orders[1].order_nr).toBe('ORD-2026-0099')
  })

  it('lege input → lege output', () => {
    expect(clusterOrdersOpKlant([])).toEqual([])
  })

  it('geblokkeerde orders (geen vervoerder) sorteren onder de startbare', () => {
    const orders = [
      makeOrder({ order_id: 1, order_nr: 'ORD-001', debiteur_nr: 100, klant_naam: 'Alpha DE' }),
      makeOrder({ order_id: 2, order_nr: 'ORD-002', debiteur_nr: 200, klant_naam: 'Beta NL' }),
      makeOrder({ order_id: 3, order_nr: 'ORD-003', debiteur_nr: 300, klant_naam: 'Gamma NL' }),
    ]
    // Alpha DE is alfabetisch eerst maar geblokkeerd → zakt naar onder.
    const geblokkeerd = new Set([1])
    const clusters = clusterOrdersOpKlant(orders, undefined, geblokkeerd)
    expect(clusters.map((c) => c.klant_naam)).toEqual(['Beta NL', 'Gamma NL', 'Alpha DE'])
  })

  it('binnen één bundel-cluster sorteren geblokkeerde orders onderaan', () => {
    const orders = [
      makeOrder({ order_id: 1, order_nr: 'ORD-001', debiteur_nr: 100, klant_naam: 'Klant A' }),
      makeOrder({ order_id: 2, order_nr: 'ORD-002', debiteur_nr: 100, klant_naam: 'Klant A' }),
    ]
    const sleutel = new Map<number, string>([
      [1, 'D100|VHST|W2026-W24|Aabc'],
      [2, 'D100|VHST|W2026-W24|Aabc'],
    ])
    const geblokkeerd = new Set([1])
    const clusters = clusterOrdersOpKlant(orders, sleutel, geblokkeerd)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].orders.map((o) => o.order_id)).toEqual([2, 1])
  })

  it('zonder geblokkeerd-set blijft de volgorde puur alfabetisch', () => {
    const orders = [
      makeOrder({ order_id: 1, order_nr: 'ORD-001', klant_naam: 'Beta' }),
      makeOrder({ order_id: 2, order_nr: 'ORD-002', klant_naam: 'Alpha' }),
    ]
    const clusters = clusterOrdersOpKlant(orders)
    expect(clusters.map((c) => c.klant_naam)).toEqual(['Alpha', 'Beta'])
  })
})

describe('groepeerOrdersOpLand', () => {
  it('splitst per ISO-2-land en clustert binnen elk land op bundel-sleutel', () => {
    const orders = [
      makeOrder({ order_id: 1, afl_land: 'NL', debiteur_nr: 100, klant_naam: 'NL Klant' }),
      makeOrder({ order_id: 2, afl_land: 'DE', debiteur_nr: 200, klant_naam: 'DE Klant 1' }),
      makeOrder({ order_id: 3, afl_land: 'DE', debiteur_nr: 200, klant_naam: 'DE Klant 1' }),
      makeOrder({ order_id: 4, afl_land: 'BE', debiteur_nr: 300, klant_naam: 'BE Klant' }),
    ]
    const sleutel = new Map<number, string>([
      [1, 'D100|VVERH|W2026-W20|Anl'],
      [2, 'D200|VDPD|W2026-W20|Ade'],
      [3, 'D200|VDPD|W2026-W20|Ade'],
      [4, 'D300|VHST|W2026-W20|Abe'],
    ])
    const groepen = groepeerOrdersOpLand(orders, sleutel)
    // Alfabetisch: BE, DE, NL
    expect(groepen.map((g) => g.iso2)).toEqual(['BE', 'DE', 'NL'])
    expect(groepen[1].clusters).toHaveLength(1) // DE: één bundel met 2 orders
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
