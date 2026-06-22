import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { labelBarcode } from '@/lib/logistiek/labelbarcode'
import { ShippingLabel } from './shipping-label'
import type { ZendingPrintRegel, ZendingPrintSet } from '../queries/zendingen'

// RENDER-KARAKTERISERING (slice 4, plan 2026-06-18-verzendlabel-een-deep-module):
// het verzendlabel had vóór deze refactor géén render-test. Deze suite bevriest
// het zichtbare gedrag van de ene canonieke `ShippingLabel`: de depot-lookup
// (alleen HST), de volledige vervoerder-badge (geen afgekapte "Rhe…"), de
// SSCC-barcode-bron en de aanwezigheid van alle informatieve zones.
//
// `ShippingLabel` is een pure render (geen hooks/queries) → geen provider nodig.

function maakZending(o: Partial<ZendingPrintSet> = {}): ZendingPrintSet {
  return {
    id: 2585,
    zending_nr: 'ZEND-2026-0003',
    status: 'Picken',
    vervoerder_code: 'hst_api',
    service_code: null,
    verzenddatum: '2026-06-12',
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
    ...o,
  }
}

interface RenderOpties {
  vervoerderNaam?: string
  sscc?: string | null
  colliIndex?: number
  colliTotal?: number
  regel?: ZendingPrintRegel | null
  omstickerSnapshot?: string | null
}

function renderLabel(zending: ZendingPrintSet, opts: RenderOpties = {}) {
  // `?? default` zou een EXPLICIETE null terugdraaien naar de default; gebruik
  // daarom een undefined-check zodat `{ sscc: null }` echt null doorgeeft.
  const sscc = opts.sscc === undefined ? '087159540000000656' : opts.sscc
  return render(
    <ShippingLabel
      zending={zending}
      regel={opts.regel ?? null}
      colliIndex={opts.colliIndex ?? 1}
      colliTotal={opts.colliTotal ?? 1}
      vervoerderNaam={opts.vervoerderNaam ?? 'HST'}
      sscc={sscc}
      omschrijvingSnapshot={null}
      klantOmschrijvingSnapshot={null}
      klanteigenNaamSnapshot={null}
      omstickerSnapshot={opts.omstickerSnapshot ?? null}
    />,
  )
}

describe('ShippingLabel — depot (alleen HST)', () => {
  it('HST + NL-postcode → toont het depotnummer en de volledige badge', () => {
    const { container } = renderLabel(
      maakZending({ vervoerder_code: 'hst_api', afl_postcode: '2121 AX', afl_land: 'NL' }),
      { vervoerderNaam: 'HST' },
    )
    // Postcode 2121 valt in NL-range [2100,2899] → depot 27 (hst-depot.ts).
    expect(container.textContent).toContain('Depot 27')
    // Badge volledig aanwezig (geen afkapping in de DOM).
    expect(container.textContent).toContain('HST')
  })

  it('Rhenus → géén depot-tekst, badge "Rhenus" volledig (niet afgekapt)', () => {
    const { container } = renderLabel(
      maakZending({ vervoerder_code: 'rhenus_sftp', afl_postcode: '40210', afl_land: 'DE' }),
      { vervoerderNaam: 'Rhenus' },
    )
    expect(container.textContent).not.toContain('Depot')
    // De afkapping ("Rhe…") was puur CSS; de volledige tekst hoort in de DOM.
    expect(container.textContent).toContain('Rhenus')
  })
})

describe('ShippingLabel — barcode-bron', () => {
  it('sscc gezet → barcode-waarde = labelBarcode(sscc) (AI(00)+SSCC)', () => {
    const sscc = '087159540000000656'
    const { container, getByRole } = renderLabel(maakZending(), { sscc })

    const verwacht = labelBarcode(sscc)
    expect(verwacht).toBe('00087159540000000656')
    // De Code128-svg draagt de exacte waarde als toegankelijke naam...
    expect(getByRole('img', { name: `Barcode ${verwacht}` })).toBeInTheDocument()
    // ...en de leesbare cijferreeks staat eronder.
    expect(container.textContent).toContain(verwacht)
    expect(container.textContent).not.toContain('Geen colli-barcode geregistreerd')
  })

  it('sscc=null → géén barcode, wel de "geen barcode"-melding', () => {
    const { container, queryByRole } = renderLabel(maakZending(), { sscc: null })

    expect(queryByRole('img')).toBeNull()
    expect(container.textContent).toContain('Geen colli-barcode geregistreerd')
  })
})

describe('ShippingLabel — informatieve zones', () => {
  it('toont order_nr, afleveradres, "X VAN Y", referentie-label + datum', () => {
    const zending = maakZending({
      afl_naam: 'Fam. ten Velde',
      afl_adres: 'Leidsevaart 8',
      afl_postcode: '2121 AX',
      afl_plaats: 'Bennebroek',
      verzenddatum: '2026-06-12',
    })
    const { container } = renderLabel(zending, { colliIndex: 1, colliTotal: 3 })

    const text = container.textContent ?? ''
    expect(text).toContain('ORD-2026-0107') // order_nr
    expect(text).toContain('Fam. ten Velde') // afleveradres-naam
    expect(text).toContain('Leidsevaart 8') // afleveradres-straat
    expect(text).toContain('Bennebroek') // afleveradres-plaats
    expect(text).toContain('1 VAN 3') // colli-telling
    expect(text).toContain('Referentie') // referentie-zone
    expect(text).toContain('12/06/26') // bevroren verzenddatum (DD/MM/YY)
  })
})

describe('ShippingLabel — magazijnlocatie (verzoek 2026-06-19)', () => {
  function regelMetLocatie(locatie: string | null): ZendingPrintRegel {
    return {
      id: 1,
      order_regel_id: 1,
      artikelnr: 'ABC',
      rol_id: null,
      aantal: 1,
      order_regels: {
        id: 1,
        order_id: 2585,
        regelnummer: 1,
        artikelnr: 'ABC',
        omschrijving: 'Karpet',
        omschrijving_2: null,
        orderaantal: 1,
        te_leveren: 1,
        gewicht_kg: null,
        is_maatwerk: false,
        maatwerk_lengte_cm: null,
        maatwerk_breedte_cm: null,
        maatwerk_afwerking: null,
        maatwerk_band_kleur: null,
        maatwerk_kwaliteit_code: null,
        maatwerk_kleur_code: null,
        maatwerk_oppervlak_m2: null,
        producten: {
          ean_code: null,
          omschrijving: 'Karpet',
          vervolgomschrijving: null,
          gewicht_kg: null,
          lengte_cm: null,
          breedte_cm: null,
          vorm: null,
          kleur_code: null,
          karpi_code: null,
          locatie,
        },
      },
    }
  }

  it('product met locatie → toont de kale locatiecode (geen "Locatie:"-label)', () => {
    const { container } = renderLabel(maakZending(), { regel: regelMetLocatie('A.01.L') })
    expect(container.textContent).toContain('A.01.L')
    expect(container.textContent).not.toContain('Locatie:')
  })

  it('product zonder locatie → toont niets', () => {
    const { container } = renderLabel(maakZending(), { regel: regelMetLocatie(null) })
    expect(container.textContent).not.toContain('Locatie')
  })
})

describe('ShippingLabel — omsticker (mig 436)', () => {
  it('omstickerSnapshot gezet → toont de "OMB:"-regel met de fysieke karpi_code', () => {
    const { container } = renderLabel(maakZending(), {
      omstickerSnapshot: 'TIFF13XX160230',
    })
    expect(container.textContent).toContain('OMB: TIFF13XX160230')
  })

  it('omstickerSnapshot=null → géén "OMB:"-regel', () => {
    const { container } = renderLabel(maakZending(), { omstickerSnapshot: null })
    expect(container.textContent).not.toContain('OMB:')
  })
})
