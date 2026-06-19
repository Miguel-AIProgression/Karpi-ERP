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
