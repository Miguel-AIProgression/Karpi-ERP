import { describe, it, expect } from 'vitest'
import { vindtAchtergeblevenCombiLeveringLeden } from './combi-levering-achtergebleven'
import type { PickShipOrder } from '../../magazijn/lib/types'

function order(overrides: Partial<PickShipOrder> = {}): PickShipOrder {
  return {
    order_id: 1, order_nr: 'ORD-1', status: 'Klaar voor picken', klant_naam: 'Test',
    debiteur_nr: 100, afl_naam: 'X', afl_adres: 'Straat 1', afl_postcode: '1234AB',
    afl_plaats: 'Stad', afl_land: 'NL', afleverdatum: '2026-08-01', afhalen: false,
    lever_type: 'week', bucket: 'wk_1', verzend_week_sleutel: '2026-W31',
    verzend_week_label: 'Verzendweek 31', verzend_week_kort: 'Wk 31', regels: [],
    totaal_m2: 0, totaal_gewicht_kg: 0, aantal_regels: 0, alle_regels_pickbaar: true,
    heeft_gepland_zending: false, afl_adres_incompleet_sinds: null,
    afl_gln_ongekoppeld_sinds: null, afl_gln_gecontroleerd_op: null,
    prijs_ontbreekt_sinds: null, actieve_pickronde: null, wacht_op_combi_levering: false,
    ...overrides,
  }
}

describe('vindtAchtergeblevenCombiLeveringLeden', () => {
  it('geeft leeg terug als er geen andere order met dezelfde klant+adres bestaat', () => {
    const alle = [
      order({ order_id: 1, debiteur_nr: 100 }),
      order({ order_id: 2, debiteur_nr: 200, afl_adres: 'Andere straat 2' }),
    ]
    expect(vindtAchtergeblevenCombiLeveringLeden([1], alle)).toEqual([])
  })

  it('detecteert een sibling-order (zelfde debiteur+adres, zelf niet geselecteerd) die nu startbaar is', () => {
    const alle = [
      order({ order_id: 1, debiteur_nr: 100, afl_adres: 'Straat 1', afl_postcode: '1234AB', afl_land: 'NL' }),
      order({ order_id: 2, debiteur_nr: 100, afl_adres: 'Straat 1', afl_postcode: '1234AB', afl_land: 'NL' }),
    ]
    expect(vindtAchtergeblevenCombiLeveringLeden([1], alle)).toEqual([2])
  })

  it('negeert een sibling naar een ander adres', () => {
    const alle = [
      order({ order_id: 1, debiteur_nr: 100, afl_adres: 'Straat 1' }),
      order({ order_id: 2, debiteur_nr: 100, afl_adres: 'Andere straat 9' }),
    ]
    expect(vindtAchtergeblevenCombiLeveringLeden([1], alle)).toEqual([])
  })

  it('negeert een sibling die zelf nog wacht_op_combi_levering=true heeft (nog niet startbaar)', () => {
    const alle = [
      order({ order_id: 1, debiteur_nr: 100, afl_adres: 'Straat 1' }),
      order({ order_id: 2, debiteur_nr: 100, afl_adres: 'Straat 1', wacht_op_combi_levering: true }),
    ]
    expect(vindtAchtergeblevenCombiLeveringLeden([1], alle)).toEqual([])
  })
})
