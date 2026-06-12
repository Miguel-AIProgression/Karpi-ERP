import { describe, it, expect } from 'vitest'
import { expandLabels } from './printset'
import type {
  ZendingPrintColli,
  ZendingPrintRegel,
  ZendingPrintSet,
} from '../queries/zendingen'

// Regressietest HST-overlossing-incident 12-06-2026: de geprinte labels
// droegen client-side gegenereerde SSCC's (zending-id + colli-index) terwijl
// hst-send de DB-SSCC's uit `zending_colli` aanmeldde. HST kon de gescande
// labels daardoor aan niets koppelen. Invariant sindsdien: een label-SSCC
// komt UITSLUITEND uit `zending_colli.sscc` — of is afwezig (null).

function maakRegel(overrides: Partial<ZendingPrintRegel> = {}): ZendingPrintRegel {
  return {
    id: 1,
    order_regel_id: 10,
    artikelnr: 'ART-1',
    rol_id: null,
    aantal: 1,
    order_regels: null,
    ...overrides,
  }
}

function maakColli(overrides: Partial<ZendingPrintColli> = {}): ZendingPrintColli {
  return {
    id: 1,
    colli_nr: 1,
    sscc: '087159540000000656',
    order_regel_id: 10,
    ...overrides,
  }
}

function maakZending(overrides: Partial<ZendingPrintSet> = {}): ZendingPrintSet {
  return {
    id: 28,
    zending_nr: 'ZEND-2026-0003',
    status: 'Picken',
    vervoerder_code: 'hst_api',
    service_code: null,
    verzenddatum: null,
    track_trace: null,
    afl_naam: 'Fam. ten Velde',
    afl_adres: 'Leidsevaart 8',
    afl_postcode: '2121 AX',
    afl_plaats: 'Bennebroek',
    afl_land: 'NL',
    afl_telefoon: null,
    aantal_colli: 1,
    totaal_gewicht_kg: null,
    opmerkingen: null,
    created_at: '2026-06-11T07:33:28Z',
    vervoerders: null,
    orders: {
      id: 2585,
      order_nr: 'ORD-2026-0107',
      oud_order_nr: null,
      klant_referentie: null,
      orderdatum: null,
      afleverdatum: null,
      week: null,
      afhalen: false,
      lever_modus: null,
      debiteur_nr: 152009,
      vertegenw_code: null,
      fact_naam: null,
      fact_adres: null,
      fact_postcode: null,
      fact_plaats: null,
      fact_land: null,
      afl_naam_2: null,
      debiteuren: null,
      vertegenwoordigers: null,
    },
    bundel_orders: [],
    zending_regels: [],
    zending_colli: [],
    ...overrides,
  }
}

describe('expandLabels — SSCC-bron-van-waarheid', () => {
  it('print exact de DB-SSCC van elke colli (zelfde waarde als de HST-aanmelding)', () => {
    const zending = maakZending({
      zending_regels: [maakRegel()],
      zending_colli: [maakColli({ sscc: '087159540000000656' })],
    })

    const labels = expandLabels(zending)

    expect(labels).toHaveLength(1)
    expect(labels[0].sscc).toBe('087159540000000656')
    // Het incident-patroon: de oude client-side generator maakte voor
    // zending 28 / colli 1 déze waarde — die mag nooit meer verschijnen.
    expect(labels[0].sscc).not.toBe('087159540000002810')
  })

  it('sorteert op colli_nr en koppelt de regel via order_regel_id', () => {
    const regelA = maakRegel({ id: 1, order_regel_id: 10, artikelnr: 'ART-A' })
    const regelB = maakRegel({ id: 2, order_regel_id: 20, artikelnr: 'ART-B' })
    const zending = maakZending({
      zending_regels: [regelA, regelB],
      zending_colli: [
        maakColli({ id: 2, colli_nr: 2, sscc: '087159540000000663', order_regel_id: 20 }),
        maakColli({ id: 1, colli_nr: 1, sscc: '087159540000000656', order_regel_id: 10 }),
      ],
    })

    const labels = expandLabels(zending)

    expect(labels.map((l) => l.sscc)).toEqual([
      '087159540000000656',
      '087159540000000663',
    ])
    expect(labels.map((l) => l.index)).toEqual([1, 2])
    expect(labels[0].regel?.artikelnr).toBe('ART-A')
    expect(labels[1].regel?.artikelnr).toBe('ART-B')
  })

  it('colli zonder order_regel_id krijgt een label zonder regel-info', () => {
    const zending = maakZending({
      zending_regels: [maakRegel()],
      zending_colli: [maakColli({ order_regel_id: null })],
    })

    const labels = expandLabels(zending)

    expect(labels).toHaveLength(1)
    expect(labels[0].regel).toBeNull()
    expect(labels[0].sscc).toBe('087159540000000656')
  })

  it('legacy-zending zonder colli-rijen → labels ZONDER barcode (nooit zelf genereren)', () => {
    const zending = maakZending({
      zending_regels: [maakRegel({ aantal: 2 })],
      zending_colli: [],
    })

    const labels = expandLabels(zending)

    expect(labels).toHaveLength(2)
    expect(labels.every((l) => l.sscc === null)).toBe(true)
  })

  it('verzendkosten-regel (VERZEND) telt niet mee als fysiek label', () => {
    const zending = maakZending({
      zending_regels: [
        maakRegel({ id: 1, order_regel_id: 10 }),
        maakRegel({ id: 2, order_regel_id: 11, artikelnr: 'VERZEND' }),
      ],
      zending_colli: [],
    })

    const labels = expandLabels(zending)

    expect(labels).toHaveLength(1)
    expect(labels[0].sscc).toBeNull()
  })
})
