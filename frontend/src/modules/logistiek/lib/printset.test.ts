import { describe, it, expect } from 'vitest'
import { expandLabels } from './printset'
import {
  klanteigenReferentie,
  labelDatumKort,
  labelReferentie,
  productMaat,
  productNamen,
} from './shipping-label-data'
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
    omschrijving_snapshot: null,
    klant_omschrijving_snapshot: null,
    klanteigen_naam_snapshot: null,
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

// Mig 388: omschrijving = single source uit `zending_colli`-snapshot. De
// print-laag leidt niets meer live af zodra een colli geregistreerd is; een
// latere wijziging op order_regels/producten verandert het label dus NIET.
describe('expandLabels + productNamen — omschrijving-snapshot single source', () => {
  it('draagt de snapshot-omschrijvingen door op het LabelItem', () => {
    const zending = maakZending({
      zending_regels: [maakRegel()],
      zending_colli: [
        maakColli({
          omschrijving_snapshot: 'Egyptische Wol 240x330 cm',
          klant_omschrijving_snapshot: 'RUBI 15 — RECHTHOEK / 240 X 330 CM',
        }),
      ],
    })

    const [label] = expandLabels(zending)

    expect(label.omschrijvingSnapshot).toBe('Egyptische Wol 240x330 cm')
    expect(label.klantOmschrijvingSnapshot).toBe('RUBI 15 — RECHTHOEK / 240 X 330 CM')
  })

  it('legacy-colli zonder snapshot → beide velden null (val terug op live regel)', () => {
    const zending = maakZending({
      zending_regels: [maakRegel()],
      zending_colli: [maakColli()],
    })

    const [label] = expandLabels(zending)

    expect(label.omschrijvingSnapshot).toBeNull()
    expect(label.klantOmschrijvingSnapshot).toBeNull()
  })

  it('productNamen: snapshot wint van de live order_regel-omschrijving', () => {
    const regel = maakRegel({
      order_regels: {
        id: 10,
        order_id: 1,
        regelnummer: 1,
        artikelnr: 'ART-1',
        omschrijving: 'OUDE LIVE NAAM',
        omschrijving_2: null,
        orderaantal: 1,
        te_leveren: 1,
        gewicht_kg: null,
        is_maatwerk: false,
        maatwerk_lengte_cm: null,
        maatwerk_breedte_cm: null,
        maatwerk_afwerking: null,
        maatwerk_kwaliteit_code: null,
        maatwerk_kleur_code: null,
        maatwerk_oppervlak_m2: null,
        producten: {
          ean_code: null,
          omschrijving: 'OUDE PRODUCTNAAM',
          vervolgomschrijving: null,
          gewicht_kg: null,
          lengte_cm: null,
          breedte_cm: null,
          vorm: null,
        },
      },
    })

    const namen = productNamen(regel, {
      omschrijvingSnapshot: 'Egyptische Wol 240x330 cm',
      klantOmschrijvingSnapshot: 'RUBI 15',
    })

    expect(namen.klantNaam).toBe('RUBI 15')
    expect(namen.karpiNaam).toBe('Egyptische Wol 240x330 cm')
  })

  it('productMaat: geen aparte maat als die al in de product-snapshot zit', () => {
    const regel = maakRegel({
      order_regels: {
        id: 10,
        order_id: 1,
        regelnummer: 1,
        artikelnr: 'ART-1',
        omschrijving: null,
        omschrijving_2: null,
        orderaantal: 1,
        te_leveren: 1,
        gewicht_kg: null,
        is_maatwerk: true,
        maatwerk_lengte_cm: 330,
        maatwerk_breedte_cm: 240,
        maatwerk_afwerking: null,
        maatwerk_kwaliteit_code: null,
        maatwerk_kleur_code: null,
        maatwerk_oppervlak_m2: null,
        producten: null,
      },
    })

    // Met snapshot: maat zit in omschrijvingSnapshot → geen dubbele maat-regel.
    expect(
      productMaat(regel, {
        omschrijvingSnapshot: 'MAATW. SISAL 240x330 cm',
        klantOmschrijvingSnapshot: null,
      }),
    ).toBe('')
    // Legacy (geen snapshot): live maat-afleiding blijft.
    expect(productMaat(regel, null)).toBe('240x330 cm')
  })
})

describe('label-datum + referentie (mig 388, D/E)', () => {
  it('labelDatumKort gebruikt de verzenddatum (niet de printdatum), fallback created_at', () => {
    expect(
      labelDatumKort({ verzenddatum: '2026-06-12', created_at: '2026-06-01T00:00:00Z' }),
    ).toBe('12/06/26')
    expect(
      labelDatumKort({ verzenddatum: null, created_at: '2026-06-01T10:00:00Z' }),
    ).toBe('01/06/26')
  })

  it('labelReferentie: Basta-ordernr wint van interne id, 6 cijfers', () => {
    expect(labelReferentie({ oud_order_nr: 12345, id: 999 })).toBe('012345')
    expect(labelReferentie({ oud_order_nr: null, id: 42 })).toBe('000042')
  })
})

// Mig 418: klant-eigennaam voor de kwaliteit ("Uw referentie") — bevroren in
// zending_colli.klanteigen_naam_snapshot, puur doorgegeven aan het label.
describe('expandLabels — klant-eigennaam-snapshot (Uw referentie)', () => {
  it('draagt de klanteigen-naam door op het LabelItem', () => {
    const zending = maakZending({
      zending_regels: [maakRegel()],
      zending_colli: [maakColli({ klanteigen_naam_snapshot: 'BREDA' })],
    })

    const [label] = expandLabels(zending)

    expect(label.klanteigenNaamSnapshot).toBe('BREDA')
  })

  it('colli zonder eigennaam → null (geen Uw-referentie-regel)', () => {
    const zending = maakZending({
      zending_regels: [maakRegel()],
      zending_colli: [maakColli()],
    })

    const [label] = expandLabels(zending)

    expect(label.klanteigenNaamSnapshot).toBeNull()
  })

  it('legacy-zending zonder colli-rijen → klanteigenNaamSnapshot null', () => {
    const zending = maakZending({
      zending_regels: [maakRegel()],
      zending_colli: [],
    })

    const [label] = expandLabels(zending)

    expect(label.klanteigenNaamSnapshot).toBeNull()
  })

  it('klanteigenReferentie: leeg/whitespace → null, anders getrimd', () => {
    expect(klanteigenReferentie(null)).toBeNull()
    expect(klanteigenReferentie('')).toBeNull()
    expect(klanteigenReferentie('   ')).toBeNull()
    expect(klanteigenReferentie('  BREDA  ')).toBe('BREDA')
  })
})
