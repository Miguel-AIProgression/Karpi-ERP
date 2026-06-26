// Deno test: `npx deno test supabase/functions/_shared/pakbon/aggregatie.test.ts --no-check`
//
// Spiegelt de karakteriseringstest van de React-pakbon
// (frontend pakbon-document.test.tsx) op de gedeelde aggregatie + document-
// builder. Slaagvoorwaarde: dezelfde scenario's (sortering, besteld/geleverd,
// gewicht, VERZEND-filter, bundel-groepering, legacy-pad, maatwerk-maat) geven
// hetzelfde resultaat — zo borgen we dat de server-pakbon-PDF byte-identieke
// regelinhoud levert aan de huidige geprinte pakbon.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { bouwPakbonRegels } from './aggregatie.ts'
import { bouwPakbonDocument } from './pakbon-document.ts'
import type {
  PakbonColliInput,
  PakbonOrderRegel,
  PakbonRegelInput,
  PakbonZendingInput,
} from './types.ts'

function maakOrderRegel(o: Partial<PakbonOrderRegel> = {}): PakbonOrderRegel {
  return {
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
    producten: null,
    ...o,
  }
}

function maakRegel(o: Partial<PakbonRegelInput> = {}): PakbonRegelInput {
  return { id: 1, order_regel_id: 10, artikelnr: 'ART-1', aantal: 1, order_regels: maakOrderRegel(), ...o }
}

function maakColli(o: Partial<PakbonColliInput> = {}): PakbonColliInput {
  return { colli_nr: 1, sscc: '087159540000000656', order_regel_id: 10, omschrijving_snapshot: null, klant_omschrijving_snapshot: null, omsticker_snapshot: null, ...o }
}

function maakZending(o: Partial<PakbonZendingInput> = {}): PakbonZendingInput {
  return {
    zending_nr: 'ZEND-2026-0003',
    verzenddatum: '2026-06-12',
    created_at: '2026-06-11T07:33:28Z',
    afl_naam: 'Fam. ten Velde',
    afl_adres: 'Leidsevaart 8',
    afl_postcode: '2121 AX',
    afl_plaats: 'Bennebroek',
    afl_land: 'NL',
    afl_telefoon: null,
    aantal_colli: 1,
    totaal_gewicht_kg: null,
    orders: {
      id: 1,
      order_nr: 'ORD-2026-0107',
      klant_referentie: null,
      week: null,
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

Deno.test('sorteert regels op regelnummer en levert besteld/geleverd per regel', () => {
  const regelB = maakRegel({ id: 1, order_regel_id: 10, artikelnr: 'ART-B', aantal: 3, order_regels: maakOrderRegel({ regelnummer: 2, artikelnr: 'ART-B', orderaantal: 5 }) })
  const regelA = maakRegel({ id: 2, order_regel_id: 20, artikelnr: 'ART-A', aantal: 2, order_regels: maakOrderRegel({ regelnummer: 1, artikelnr: 'ART-A', orderaantal: 4 }) })
  const regels = bouwPakbonRegels(maakZending({ zending_regels: [regelB, regelA] }))

  assertEquals(regels.map((r) => r.regel.artikelnr), ['ART-A', 'ART-B'])
  assertEquals([regels[0].besteld, regels[0].geleverd], [4, 2])
  assertEquals([regels[1].besteld, regels[1].geleverd], [5, 3])
})

Deno.test('totaal-gewicht: SUM(regelgewicht × geleverd) als totaal_gewicht_kg leeg is', () => {
  const zending = maakZending({
    totaal_gewicht_kg: null,
    zending_regels: [
      maakRegel({ id: 1, order_regel_id: 10, aantal: 2, order_regels: maakOrderRegel({ regelnummer: 1, gewicht_kg: 10 }) }),
      maakRegel({ id: 2, order_regel_id: 20, aantal: 3, order_regels: maakOrderRegel({ regelnummer: 2, gewicht_kg: 8 }) }),
    ],
  })
  assertEquals(bouwPakbonDocument(zending).totaalGewichtKg, 44) // 10×2 + 8×3
})

Deno.test('totaal-gewicht: zendingen.totaal_gewicht_kg wint als die gezet is', () => {
  const zending = maakZending({
    totaal_gewicht_kg: 99.5,
    zending_regels: [maakRegel({ order_regels: maakOrderRegel({ regelnummer: 1, gewicht_kg: 10 }) })],
    zending_colli: [maakColli()],
  })
  assertEquals(bouwPakbonDocument(zending).totaalGewichtKg, 99.5)
})

Deno.test('kolli komt uit de opties (label-expansie), anders aantal_colli', () => {
  const zending = maakZending({ aantal_colli: 1, zending_regels: [maakRegel()] })
  assertEquals(bouwPakbonDocument(zending, { kolli: 4 }).kolli, 4)
  assertEquals(bouwPakbonDocument(zending).kolli, 1)
})

Deno.test('VERZEND-regel verschijnt niet als pakbonregel', () => {
  const zending = maakZending({
    zending_regels: [
      maakRegel({ id: 1, order_regel_id: 10, artikelnr: 'ART-A', order_regels: maakOrderRegel({ regelnummer: 1, artikelnr: 'ART-A' }) }),
      maakRegel({ id: 2, order_regel_id: 11, artikelnr: 'VERZEND', order_regels: maakOrderRegel({ regelnummer: 2, artikelnr: 'VERZEND' }) }),
    ],
  })
  assertEquals(bouwPakbonRegels(zending).map((r) => r.regel.artikelnr), ['ART-A'])
})

Deno.test('maatwerk: losse maat-regel verborgen mét colli (ook lege snapshot), zichtbaar zonder colli', () => {
  const maak = (colli: boolean) =>
    maakZending({
      zending_regels: [
        maakRegel({ id: 1, order_regel_id: 10, artikelnr: 'ART-MW', order_regels: maakOrderRegel({ regelnummer: 1, artikelnr: 'ART-MW', is_maatwerk: true, maatwerk_breedte_cm: 240, maatwerk_lengte_cm: 330 }) }),
      ],
      zending_colli: colli ? [maakColli({ order_regel_id: 10 })] : [],
    })

  assertEquals(bouwPakbonDocument(maak(true)).groepen[0].regels[0].maatRegel, null)
  assertEquals(bouwPakbonDocument(maak(false)).groepen[0].regels[0].maatRegel, 'Op maat 240 x 330 cm')
})

const AFWERKING_TYPES = new Map([
  ['B', { naam: 'Breedband', type_bewerking: 'breedband' }],
  ['SB', { naam: 'Smalband', type_bewerking: 'smalband' }],
])

Deno.test('afwerkingRegel: Breedband toont de bandkleur, ook mét colli-snapshot', () => {
  const zending = maakZending({
    zending_regels: [
      maakRegel({ order_regel_id: 10, order_regels: maakOrderRegel({ regelnummer: 1, maatwerk_afwerking: 'B', maatwerk_band_kleur: 'KK21' }) }),
    ],
    zending_colli: [maakColli({ order_regel_id: 10, omschrijving_snapshot: 'BERM 21 350x250 cm' })],
  })
  const regel = bouwPakbonDocument(zending, { afwerkingTypes: AFWERKING_TYPES }).groepen[0].regels[0]
  assertEquals(regel.afwerkingRegel, 'Breedband - band KK21')
})

Deno.test('afwerkingRegel: Smalband met bandkleur toont de band NIET', () => {
  const zending = maakZending({
    zending_regels: [
      maakRegel({ order_regel_id: 10, order_regels: maakOrderRegel({ regelnummer: 1, maatwerk_afwerking: 'SB', maatwerk_band_kleur: 'Piero Groen 1073' }) }),
    ],
  })
  const regel = bouwPakbonDocument(zending, { afwerkingTypes: AFWERKING_TYPES }).groepen[0].regels[0]
  assertEquals(regel.afwerkingRegel, 'Smalband')
})

Deno.test('afwerkingRegel: geen afwerking-code → null (geen sub-regel)', () => {
  const zending = maakZending({ zending_regels: [maakRegel({ order_regel_id: 10 })] })
  const regel = bouwPakbonDocument(zending, { afwerkingTypes: AFWERKING_TYPES }).groepen[0].regels[0]
  assertEquals(regel.afwerkingRegel, null)
})

Deno.test('bundel-zending: groep per bron-order in bundel-volgorde', () => {
  const zending = maakZending({
    bundel_orders: [
      { id: 1, order_nr: 'ORD-2026-0001', klant_referentie: 'REF-1', week: null },
      { id: 2, order_nr: 'ORD-2026-0002', klant_referentie: 'REF-2', week: null },
    ],
    zending_regels: [
      maakRegel({ id: 1, order_regel_id: 10, artikelnr: 'ART-EEN', order_regels: maakOrderRegel({ order_id: 1, regelnummer: 1, artikelnr: 'ART-EEN' }) }),
      maakRegel({ id: 2, order_regel_id: 20, artikelnr: 'ART-TWEE', order_regels: maakOrderRegel({ order_id: 2, regelnummer: 1, artikelnr: 'ART-TWEE' }) }),
    ],
    zending_colli: [maakColli({ colli_nr: 1, order_regel_id: 10 }), maakColli({ colli_nr: 2, order_regel_id: 20 })],
  })
  const doc = bouwPakbonDocument(zending)
  assertEquals(doc.isBundel, true)
  assertEquals(doc.groepen.map((g) => g.orderNr), ['ORD-2026-0001', 'ORD-2026-0002'])
  assertEquals(doc.groepen[0].regels[0].artikelnr, 'ART-EEN')
  assertEquals(doc.groepen[1].regels[0].artikelnr, 'ART-TWEE')
})

Deno.test('legacy-zending zonder colli: geleverd uit zending_regels.aantal', () => {
  const zending = maakZending({
    zending_regels: [maakRegel({ id: 1, order_regel_id: 10, artikelnr: 'ART-A', aantal: 2, order_regels: maakOrderRegel({ regelnummer: 1, artikelnr: 'ART-A', orderaantal: 4 }) })],
    zending_colli: [],
  })
  const regels = bouwPakbonRegels(zending)
  assertEquals([regels[0].besteld, regels[0].geleverd], [4, 2])
})

Deno.test('factuuradres + afleveradres: land alleen tonen als ≠ NL', () => {
  const nl = bouwPakbonDocument(maakZending({ zending_regels: [maakRegel()] }))
  assertEquals(nl.afleveradres.some((r) => r === 'NEDERLAND'), false)
  const de = bouwPakbonDocument(
    maakZending({ afl_land: 'DE', zending_regels: [maakRegel()], orders: { ...maakZending().orders, fact_land: 'DE' } }),
  )
  assertEquals(de.afleveradres.some((r) => r === 'DUITSLAND'), true)
  assertEquals(de.factuuradres.some((r) => r === 'DUITSLAND'), true)
})

Deno.test('uw-naam-subregel alleen als Karpi-naam afwijkt van klant-naam', () => {
  const zending = maakZending({
    zending_regels: [maakRegel({ order_regel_id: 10 })],
    zending_colli: [maakColli({ order_regel_id: 10, omschrijving_snapshot: 'Egyptische Wol 240x330 cm', klant_omschrijving_snapshot: 'RUBI 15' })],
  })
  const regel = bouwPakbonDocument(zending).groepen[0].regels[0]
  assertEquals(regel.hoofdNaam, 'Egyptische Wol 240x330 cm')
  assertEquals(regel.uwNaam, 'RUBI 15')
})

Deno.test('"Uw naam" onderdrukt als klant-naam de hoofdregel-mín-maat / artikelcode is (klantNaamWijktAf)', () => {
  const zending = maakZending({
    zending_regels: [maakRegel({ order_regel_id: 10, artikelnr: 'PLUS11XX120RND', order_regels: maakOrderRegel({ regelnummer: 1, artikelnr: 'PLUS11XX120RND' }) })],
    zending_colli: [maakColli({ order_regel_id: 10, omschrijving_snapshot: 'PLUS11XX120RND 120x120 cm', klant_omschrijving_snapshot: 'PLUS11XX120RND' })],
  })
  assertEquals(bouwPakbonDocument(zending).groepen[0].regels[0].uwNaam, null)
})

Deno.test('omsticker (mig 436): OMB-codes per regel in het display-document', () => {
  const zending = maakZending({
    zending_regels: [maakRegel({ order_regel_id: 10, artikelnr: '522230010', order_regels: maakOrderRegel({ regelnummer: 1, artikelnr: '522230010' }) })],
    zending_colli: [maakColli({ order_regel_id: 10, omsticker_snapshot: 'TIFF23XX200290' })],
  })
  assertEquals(bouwPakbonDocument(zending).groepen[0].regels[0].omstickerCodes, ['TIFF23XX200290'])
})

Deno.test('routecode = geïnjecteerde render-context (niet debiteuren.route)', () => {
  const zending = maakZending({ zending_regels: [maakRegel()] })
  assertEquals(bouwPakbonDocument(zending).routecode, null) // factuurmail-PDF: geen routecode
  assertEquals(bouwPakbonDocument(zending, { routecode: '27' }).routecode, '27') // geprinte pakbon
})

Deno.test('externReferentie: interne Shopify-suffix gestript op referentie + bundel-regels', () => {
  const solo = bouwPakbonDocument(
    maakZending({
      zending_regels: [maakRegel()],
      orders: { ...maakZending().orders, klant_referentie: 'PO-123 / Shopify: #5590' },
    }),
  )
  assertEquals(solo.referentieRegel, 'PO-123')

  const bundel = bouwPakbonDocument(
    maakZending({
      bundel_orders: [
        { id: 1, order_nr: 'ORD-2026-0001', klant_referentie: 'GOOSSEN / Shopify: #1', week: null },
        { id: 2, order_nr: 'ORD-2026-0002', klant_referentie: 'REF-2', week: 'W24' },
      ],
      zending_regels: [
        maakRegel({ id: 1, order_regel_id: 10, order_regels: maakOrderRegel({ order_id: 1, regelnummer: 1 }) }),
        maakRegel({ id: 2, order_regel_id: 20, order_regels: maakOrderRegel({ order_id: 2, regelnummer: 1 }) }),
      ],
      zending_colli: [maakColli({ colli_nr: 1, order_regel_id: 10 }), maakColli({ colli_nr: 2, order_regel_id: 20 })],
    }),
  )
  assertEquals(bundel.bundelRegels, ['· ORD-2026-0001 : Ref. GOOSSEN', '· ORD-2026-0002 : Ref. REF-2 (WK W24)'])
})

// GOLDEN (ADR-0036-patroon): één representatieve zending → één volledig
// `PakbonDocument`. Pint de canonieke representatie die zowel de geprinte
// React-pakbon als de pdf-lib-PDF consumeren — divergeren kan niet meer.
Deno.test('golden: volledig PakbonDocument', () => {
  const zending = maakZending({
    zending_regels: [
      maakRegel({ id: 1, order_regel_id: 10, artikelnr: '522230010', aantal: 2, order_regels: maakOrderRegel({ regelnummer: 1, artikelnr: '522230010', orderaantal: 2, gewicht_kg: 5 }) }),
    ],
    zending_colli: [maakColli({ order_regel_id: 10, omschrijving_snapshot: 'TIFFANY 23 200x290 cm', klant_omschrijving_snapshot: 'BREDA', omsticker_snapshot: 'TIFF23XX200290' })],
  })
  const doc = bouwPakbonDocument(zending, { kolli: 1, routecode: '27' })
  assertEquals(doc, {
    pakbonnr: 'ZEND-2026-0003',
    datum: '12-06-2026',
    afleveradres: ['Fam. ten Velde', 'Leidsevaart 8', '2121 AX Bennebroek'],
    afleverTelefoon: null,
    factuuradres: ['Karpi Klant', 'Straat 1', '1000 AA Plaats'],
    isBundel: false,
    isDeelzending: false,
    referentieRegel: '-',
    vertegenwoordiger: '-',
    orderDebiteur: 'ORD-2026-0107/152009',
    debiteur: '152009',
    routecode: '27',
    bundelRegels: [],
    groepen: [
      {
        orderId: 1,
        orderNr: null,
        regels: [
          {
            regelnummer: '01',
            artikelnr: '522230010',
            hoofdNaam: 'TIFFANY 23 200x290 cm',
            uwNaam: 'BREDA',
            maatRegel: null,
            afwerkingRegel: null,
            omstickerCodes: ['TIFF23XX200290'],
            besteld: '2',
            geleverd: '2',
            isManco: false,
          },
        ],
      },
    ],
    kolli: 1,
    totaalGewichtKg: 10,
  })
})
