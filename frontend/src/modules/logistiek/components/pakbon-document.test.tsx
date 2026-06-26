import { describe, it, expect, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { formatNumber } from '@/lib/utils/formatters'
import { PakbonDocument } from './pakbon-document'
import type {
  ZendingPrintColli,
  ZendingPrintOrderRegel,
  ZendingPrintRegel,
  ZendingPrintSet,
} from '../queries/zendingen'

// KARAKTERISERINGSTEST (Task 2, plan 2026-06-14-verzenddocument-een-bron):
// bevriest het HUIDIGE gedrag van de pakbon-rijopbouw VÓÓR de consolidatie naar
// `bouwVerzenddocument`. Na de refactor (Task 4) moet deze suite onveranderd
// groen blijven — dat is de slaagvoorwaarde (byte-identieke pakbon-output).
//
// We asserten op DOM-STRUCTUUR (de twee `.text-right`-cellen per artikelregel =
// Besteld / Geleverd) i.p.v. platte tekst, zodat per-regel-waarden, sortering,
// bundel-subkoppen, totalen en het legacy-pad (zending zonder colli) exact
// worden vastgelegd.

vi.mock('@/lib/supabase/queries/bedrijfsconfig', () => ({
  fetchBedrijfsConfig: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/modules/maatwerk/queries/maatwerk-runtime', () => ({
  fetchAfwerkingTypes: vi.fn().mockResolvedValue([
    { id: 1, code: 'B', naam: 'Breedband', prijs: 0, prijs_per_meter: 0, heeft_band_kleur: true, actief: true, volgorde: 1, type_bewerking: 'breedband' },
    { id: 5, code: 'SB', naam: 'Smalband', prijs: 0, prijs_per_meter: 0, heeft_band_kleur: true, actief: true, volgorde: 5, type_bewerking: 'smalband' },
    { id: 4, code: 'ON', naam: 'Onafgewerkt', prijs: 0, prijs_per_meter: 0, heeft_band_kleur: false, actief: true, volgorde: 4, type_bewerking: null },
  ]),
}))

function renderPakbon(zending: ZendingPrintSet, colliTotal: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PakbonDocument zending={zending} vervoerderNaam="HST" colliTotal={colliTotal} />
    </QueryClientProvider>,
  )
}

// ── Fixtures ────────────────────────────────────────────────────────────────

function maakOrderRegel(o: Partial<ZendingPrintOrderRegel> = {}): ZendingPrintOrderRegel {
  return {
    id: 10,
    order_id: 1,
    regelnummer: 1,
    artikelnr: 'ART-1',
    omschrijving: null,
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
    producten: null,
    ...o,
  }
}

function maakRegel(o: Partial<ZendingPrintRegel> = {}): ZendingPrintRegel {
  return {
    id: 1,
    order_regel_id: 10,
    artikelnr: 'ART-1',
    rol_id: null,
    aantal: 1,
    order_regels: maakOrderRegel(),
    ...o,
  }
}

function maakColli(o: Partial<ZendingPrintColli> = {}): ZendingPrintColli {
  return {
    id: 1,
    colli_nr: 1,
    sscc: '087159540000000656',
    order_regel_id: 10,
    omschrijving_snapshot: null,
    klant_omschrijving_snapshot: null,
    bundel_colli_id: null,
    is_bundel: false,
    klanteigen_naam_snapshot: null,
    omsticker_snapshot: null,
    ...o,
  }
}

function maakZending(o: Partial<ZendingPrintSet> = {}): ZendingPrintSet {
  return {
    id: 28,
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
      id: 1,
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
      fact_naam: 'Karpi Klant',
      fact_adres: 'Straat 1',
      fact_postcode: '1000 AA',
      fact_plaats: 'Plaats',
      fact_land: 'NL',
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

/** Vind de artikelregel-row via de artikel-cel; lees Besteld/Geleverd uit de
 *  twee `.text-right`-cellen (= de invariant die de refactor moet bewaren). */
function bestelGeleverd(container: HTMLElement, artikelnr: string): [string, string] {
  const cel = Array.from(container.querySelectorAll('div.truncate')).find(
    (el) => el.textContent === artikelnr,
  )
  if (!cel) throw new Error(`Artikelregel ${artikelnr} niet gevonden`)
  const row = cel.parentElement as HTMLElement
  const rechts = row.querySelectorAll('.text-right')
  return [rechts[0].textContent ?? '', rechts[1].textContent ?? '']
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('PakbonDocument — karakterisering rijopbouw', () => {
  it('sorteert regels op regelnummer en toont Besteld/Geleverd per regel', () => {
    const regelB = maakRegel({
      id: 1,
      order_regel_id: 10,
      artikelnr: 'ART-B',
      aantal: 3,
      order_regels: maakOrderRegel({
        id: 10,
        regelnummer: 2,
        artikelnr: 'ART-B',
        orderaantal: 5,
        omschrijving: 'TAPIJT BLAUW',
      }),
    })
    const regelA = maakRegel({
      id: 2,
      order_regel_id: 20,
      artikelnr: 'ART-A',
      aantal: 2,
      order_regels: maakOrderRegel({
        id: 20,
        regelnummer: 1,
        artikelnr: 'ART-A',
        orderaantal: 4,
        omschrijving: 'TAPIJT ROOD',
      }),
    })
    const zending = maakZending({
      // bewust ongesorteerd in de invoer (B vóór A)
      zending_regels: [regelB, regelA],
      zending_colli: [
        maakColli({ id: 1, colli_nr: 1, order_regel_id: 20 }),
        maakColli({ id: 2, colli_nr: 2, order_regel_id: 20 }),
        maakColli({ id: 3, colli_nr: 3, order_regel_id: 10 }),
        maakColli({ id: 4, colli_nr: 4, order_regel_id: 10 }),
        maakColli({ id: 5, colli_nr: 5, order_regel_id: 10 }),
      ],
    })

    const { container } = renderPakbon(zending, 5)

    // Sortering: ART-A (regelnummer 1) staat vóór ART-B (regelnummer 2).
    const text = container.textContent ?? ''
    expect(text.indexOf('ART-A')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('ART-A')).toBeLessThan(text.indexOf('ART-B'))

    // Besteld/Geleverd per regel.
    expect(bestelGeleverd(container, 'ART-A')).toEqual([formatNumber(4), formatNumber(2)])
    expect(bestelGeleverd(container, 'ART-B')).toEqual([formatNumber(5), formatNumber(3)])
  })

  it('totaal-gewicht: SUM(regelgewicht × geleverd) als totaal_gewicht_kg leeg is', () => {
    const zending = maakZending({
      totaal_gewicht_kg: null,
      zending_regels: [
        maakRegel({
          id: 1,
          order_regel_id: 10,
          artikelnr: 'ART-A',
          aantal: 2,
          order_regels: maakOrderRegel({ id: 10, regelnummer: 1, artikelnr: 'ART-A', gewicht_kg: 10 }),
        }),
        maakRegel({
          id: 2,
          order_regel_id: 20,
          artikelnr: 'ART-B',
          aantal: 3,
          order_regels: maakOrderRegel({ id: 20, regelnummer: 2, artikelnr: 'ART-B', gewicht_kg: 8 }),
        }),
      ],
      zending_colli: [],
    })

    const { container } = renderPakbon(zending, 5)

    // 10×2 + 8×3 = 44,00
    expect(container.textContent).toContain(formatNumber(44, 2))
  })

  it('totaal-gewicht: zendingen.totaal_gewicht_kg wint als die gezet is', () => {
    const zending = maakZending({
      totaal_gewicht_kg: 99.5,
      zending_regels: [
        maakRegel({
          order_regels: maakOrderRegel({ id: 10, regelnummer: 1, artikelnr: 'ART-A', gewicht_kg: 10 }),
        }),
      ],
      zending_colli: [maakColli()],
    })

    const { container } = renderPakbon(zending, 1)

    expect(container.textContent).toContain(formatNumber(99.5, 2))
  })

  it('Kolli-totaal komt uit colliTotal-prop', () => {
    const zending = maakZending({
      zending_regels: [maakRegel({ aantal: 4 })],
      zending_colli: [
        maakColli({ id: 1, colli_nr: 1 }),
        maakColli({ id: 2, colli_nr: 2 }),
        maakColli({ id: 3, colli_nr: 3 }),
        maakColli({ id: 4, colli_nr: 4 }),
      ],
    })

    const { getByText } = renderPakbon(zending, 4)

    expect(getByText('Kolli').parentElement?.textContent).toContain(`: ${formatNumber(4)}`)
  })

  it('VERZEND-regel verschijnt niet als artikelregel', () => {
    const zending = maakZending({
      zending_regels: [
        maakRegel({
          id: 1,
          order_regel_id: 10,
          artikelnr: 'ART-A',
          order_regels: maakOrderRegel({ id: 10, regelnummer: 1, artikelnr: 'ART-A' }),
        }),
        maakRegel({
          id: 2,
          order_regel_id: 11,
          artikelnr: 'VERZEND',
          order_regels: maakOrderRegel({ id: 11, regelnummer: 2, artikelnr: 'VERZEND' }),
        }),
      ],
      zending_colli: [maakColli({ order_regel_id: 10 })],
    })

    const { container } = renderPakbon(zending, 1)

    expect(container.textContent).not.toContain('VERZEND')
    expect(container.textContent).toContain('ART-A')
  })

  it('maatwerk-regel: losse maat-regel verborgen als er een colli is (ook met lege snapshot)', () => {
    // Subtiele tak (door de reviewer gevlagd): een colli bestaat maar zijn
    // snapshot-velden zijn null. De maat-regel hangt aan colli-AANWEZIGHEID
    // (`!snapshot`), niet aan snapshot-INHOUD — dus verborgen, ook al staat de
    // maat nergens in een snapshot. Zonder colli (legacy) verschijnt hij wél.
    const maatwerkRegel = (extra: { colli: boolean }) =>
      maakZending({
        zending_regels: [
          maakRegel({
            id: 1,
            order_regel_id: 10,
            artikelnr: 'ART-MW',
            order_regels: maakOrderRegel({
              id: 10,
              regelnummer: 1,
              artikelnr: 'ART-MW',
              is_maatwerk: true,
              maatwerk_breedte_cm: 240,
              maatwerk_lengte_cm: 330,
            }),
          }),
        ],
        // colli met order_regel_id maar lege snapshot-velden (default maakColli)
        zending_colli: extra.colli ? [maakColli({ order_regel_id: 10 })] : [],
      })

    const metColli = renderPakbon(maatwerkRegel({ colli: true }), 1)
    expect(metColli.container.textContent).not.toContain('Op maat')

    const zonderColli = renderPakbon(maatwerkRegel({ colli: false }), 1)
    expect(zonderColli.container.textContent).toContain('Op maat')
  })

  it('bundel-zending: subkop per bron-order met de regels eronder', () => {
    const zending = maakZending({
      bundel_orders: [
        { id: 1, order_nr: 'ORD-2026-0001', klant_referentie: 'REF-1', week: null },
        { id: 2, order_nr: 'ORD-2026-0002', klant_referentie: 'REF-2', week: null },
      ],
      zending_regels: [
        maakRegel({
          id: 1,
          order_regel_id: 10,
          artikelnr: 'ART-EEN',
          order_regels: maakOrderRegel({ id: 10, order_id: 1, regelnummer: 1, artikelnr: 'ART-EEN' }),
        }),
        maakRegel({
          id: 2,
          order_regel_id: 20,
          artikelnr: 'ART-TWEE',
          order_regels: maakOrderRegel({ id: 20, order_id: 2, regelnummer: 1, artikelnr: 'ART-TWEE' }),
        }),
      ],
      zending_colli: [
        maakColli({ id: 1, colli_nr: 1, order_regel_id: 10 }),
        maakColli({ id: 2, colli_nr: 2, order_regel_id: 20 }),
      ],
    })

    const { getByText, container } = renderPakbon(zending, 2)

    // Subkoppen aanwezig.
    expect(getByText('Order ORD-2026-0001')).toBeInTheDocument()
    expect(getByText('Order ORD-2026-0002')).toBeInTheDocument()

    // Order-1-subkop staat vóór ART-EEN; order-2 vóór ART-TWEE (groepering).
    const text = container.textContent ?? ''
    expect(text.indexOf('Order ORD-2026-0001')).toBeLessThan(text.indexOf('ART-EEN'))
    expect(text.indexOf('ART-EEN')).toBeLessThan(text.indexOf('Order ORD-2026-0002'))
    expect(text.indexOf('Order ORD-2026-0002')).toBeLessThan(text.indexOf('ART-TWEE'))
  })

  it('Routecode = HST-depot uit de postcodeverdeling, alléén bij HST', () => {
    // HST + postcode 2121 (NL) → depot 27 (NL_DEPOTS [2100,2899,27]).
    const hst = maakZending({
      vervoerder_code: 'hst_api',
      afl_postcode: '2121 AX',
      afl_land: 'NL',
      zending_regels: [maakRegel()],
      zending_colli: [maakColli()],
    })
    const { container: hstC } = renderPakbon(hst, 1)
    expect(hstC.textContent).toContain('Routecode: 27')

    // Rhenus (niet-HST) → géén routecode, ook al ligt er een geldige postcode.
    const rhenus = maakZending({
      vervoerder_code: 'rhenus_sftp',
      afl_postcode: '2500',
      afl_land: 'BE',
      zending_regels: [maakRegel()],
      zending_colli: [maakColli()],
    })
    const { container: rhenusC } = renderPakbon(rhenus, 1)
    expect(rhenusC.textContent).not.toContain('Routecode')
  })

  it('"Uw naam" verschijnt niet als die slechts de hoofdregel mín de maat is', () => {
    // GERO-geval: hoofdregel = Karpi-omschrijving + maat, klant-snapshot = zónder
    // maat (én = de Karpi-code voor het tweede product). Geen van beide wijkt
    // zinvol af → geen "Uw naam"-subregel.
    const zending = maakZending({
      zending_regels: [
        maakRegel({
          id: 1,
          order_regel_id: 10,
          artikelnr: 'PLUS11XX120RND',
          order_regels: maakOrderRegel({ id: 10, regelnummer: 2, artikelnr: 'PLUS11XX120RND' }),
        }),
      ],
      zending_colli: [
        maakColli({
          order_regel_id: 10,
          omschrijving_snapshot: 'PLUS11XX120RND 120x120 cm',
          klant_omschrijving_snapshot: 'PLUS11XX120RND',
        }),
      ],
    })

    const { container } = renderPakbon(zending, 1)

    expect(container.textContent).toContain('PLUS11XX120RND 120x120 cm') // hoofdregel
    expect(container.textContent).not.toContain('Uw naam')
  })

  it('"Uw naam" verschijnt wél bij een echte afwijkende klant-benaming', () => {
    const zending = maakZending({
      zending_regels: [
        maakRegel({
          id: 1,
          order_regel_id: 10,
          artikelnr: 'GALA10XX200290',
          order_regels: maakOrderRegel({ id: 10, regelnummer: 1, artikelnr: 'GALA10XX200290' }),
        }),
      ],
      zending_colli: [
        maakColli({
          order_regel_id: 10,
          omschrijving_snapshot: 'GALAXY Kleur 10 200x290 cm',
          klant_omschrijving_snapshot: 'BREDA HUISMERK',
        }),
      ],
    })

    const { container } = renderPakbon(zending, 1)

    expect(container.textContent).toContain('Uw model: BREDA HUISMERK')
  })

  it('afwerking: Breedband toont de bandkleur, ook mét colli-snapshot', async () => {
    const zending = maakZending({
      zending_regels: [
        maakRegel({
          id: 1,
          order_regel_id: 10,
          artikelnr: 'ART-A',
          order_regels: maakOrderRegel({
            id: 10,
            regelnummer: 1,
            artikelnr: 'ART-A',
            maatwerk_afwerking: 'B',
            maatwerk_band_kleur: 'KK21',
          }),
        }),
      ],
      zending_colli: [maakColli({ order_regel_id: 10, omschrijving_snapshot: 'BERM 21 350x250 cm' })],
    })

    const { container } = renderPakbon(zending, 1)
    await waitFor(() => expect(container.textContent).toContain('Afwerking: Breedband - band KK21'))
  })

  it('afwerking: Smalband → niet tonen op klantdocumenten (2026-06-26)', () => {
    const zending = maakZending({
      zending_regels: [
        maakRegel({
          id: 1,
          order_regel_id: 10,
          artikelnr: 'ART-A',
          order_regels: maakOrderRegel({
            id: 10,
            regelnummer: 1,
            artikelnr: 'ART-A',
            maatwerk_afwerking: 'SB',
            maatwerk_band_kleur: 'Piero Groen 1073',
          }),
        }),
      ],
    })

    const { container } = renderPakbon(zending, 1)
    expect(container.textContent).not.toContain('Afwerking:')
    expect(container.textContent).not.toContain('Piero Groen 1073')
  })

  it('afwerking: geen afwerking-code → geen Afwerking-regel', () => {
    const zending = maakZending({ zending_regels: [maakRegel({ order_regel_id: 10 })] })
    const { container } = renderPakbon(zending, 1)
    expect(container.textContent).not.toContain('Afwerking:')
  })

  it('legacy-zending zonder colli: regels + Geleverd uit zending_regels.aantal', () => {
    const zending = maakZending({
      zending_regels: [
        maakRegel({
          id: 1,
          order_regel_id: 10,
          artikelnr: 'ART-A',
          aantal: 2,
          order_regels: maakOrderRegel({
            id: 10,
            regelnummer: 1,
            artikelnr: 'ART-A',
            orderaantal: 4,
          }),
        }),
      ],
      zending_colli: [], // legacy: geen colli-registratie
    })

    const { container } = renderPakbon(zending, 2)

    expect(bestelGeleverd(container, 'ART-A')).toEqual([formatNumber(4), formatNumber(2)])
  })

  it('mig 436: toont "OMB:" met de fysieke code als een colli een omsticker-snapshot heeft', () => {
    const zending = maakZending({
      zending_regels: [
        maakRegel({
          id: 1,
          order_regel_id: 10,
          artikelnr: '522230010',
          order_regels: maakOrderRegel({ id: 10, regelnummer: 1, artikelnr: '522230010' }),
        }),
      ],
      zending_colli: [
        maakColli({ order_regel_id: 10, omsticker_snapshot: 'TIFF23XX200290' }),
      ],
    })

    const { container } = renderPakbon(zending, 1)

    expect(container.textContent).toContain('OMB: TIFF23XX200290')
  })

  it('mig 436: geen "OMB:"-regel zonder omsticker-snapshot', () => {
    const zending = maakZending({
      zending_regels: [maakRegel({ order_regel_id: 10 })],
      zending_colli: [maakColli({ order_regel_id: 10, omsticker_snapshot: null })],
    })

    const { container } = renderPakbon(zending, 1)

    expect(container.textContent).not.toContain('OMB:')
  })

  it('mig 516: manco-regel blijft staan met besteld 1 / geleverd 0 + MANCO-label', () => {
    // Niet-gevonden colli tijdens de pickronde: voltooi_pickronde verlaagt
    // zending_regels.aantal naar 0 en zet manco_aantal=1, colli verwijderd. De
    // regel mag NIET wegvallen op de pakbon — toon besteld 1, geleverd 0, MANCO.
    const zending = maakZending({
      zending_regels: [
        maakRegel({
          id: 1,
          order_regel_id: 10,
          artikelnr: 'ART-A',
          aantal: 0,
          manco_aantal: 1,
          order_regels: maakOrderRegel({
            id: 10,
            regelnummer: 1,
            artikelnr: 'ART-A',
            orderaantal: 1,
          }),
        }),
      ],
      zending_colli: [], // colli verwijderd door de manco-melding
    })

    const { container } = renderPakbon(zending, 1)

    const [besteld, geleverd] = bestelGeleverd(container, 'ART-A')
    expect(besteld).toBe(formatNumber(1))
    // De geleverd-cel bevat "0" plus het MANCO-sublabel.
    expect(geleverd).toContain(formatNumber(0))
    expect(geleverd).toContain('MANCO')
    expect(container.textContent).toContain('MANCO')
  })
})
