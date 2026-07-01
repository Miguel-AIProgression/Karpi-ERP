// Deno test: `npx deno test supabase/functions/_shared/pakbon/pakbon-pdf.test.ts --no-check`
//
// Bugmelding Marjon 2026-07-01: pakbon ging in het Nederlands naar een Duitse
// klant, terwijl de factuur al automatisch vertaalt op basis van fact_land.
// Deze test borgt dat genereerPakbonPDF een `taal`-parameter accepteert en
// voor elke ondersteunde taal een geldige PDF produceert (zelfde smoke-test-
// stijl als factuur-pdf.test.ts — geen content-parsing, alleen magic bytes).

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { bouwPakbonDocument } from './pakbon-document.ts'
import { genereerPakbonPDF } from './pakbon-pdf.ts'
import type { PakbonBedrijf, PakbonZendingInput } from './types.ts'

const BEDRIJF: PakbonBedrijf = {
  bedrijfsnaam: 'KARPI BV',
  adres: 'Tweede Broekdijk 10',
  postcode: '7122 LB',
  plaats: 'Aalten',
  land: 'Nederland',
  telefoon: '+31 (0)543-476116',
  email: 'info@karpi.nl',
  website: 'www.karpi.nl',
  kvk: '09060322',
  btw_nummer: 'NL008543446B01',
  bank: 'ING Bank',
  iban: 'NL37INGB0689412401',
  bic: 'INGBNL2A',
}

const ZENDING: PakbonZendingInput = {
  zending_nr: 'ZEND-2026-0001',
  verzenddatum: '2026-07-01',
  created_at: '2026-07-01T10:00:00Z',
  afl_naam: 'MUSTERMANN GMBH',
  afl_adres: 'MUSTERSTRASSE 12',
  afl_postcode: '40213',
  afl_plaats: 'DUSSELDORF',
  afl_land: 'DE',
  afl_telefoon: null,
  aantal_colli: 1,
  totaal_gewicht_kg: 12.5,
  orders: {
    id: 1,
    order_nr: 'ORD-2026-0001',
    klant_referentie: 'REF123',
    week: '27',
    debiteur_nr: 600100,
    vertegenw_code: null,
    fact_naam: 'MUSTERMANN GMBH',
    fact_adres: 'MUSTERSTRASSE 12',
    fact_postcode: '40213',
    fact_plaats: 'DUSSELDORF',
    fact_land: 'DE',
    afl_naam_2: null,
    debiteuren: { naam: 'MUSTERMANN GMBH' },
    vertegenwoordigers: null,
  },
  bundel_orders: [],
  zending_regels: [
    {
      id: 1,
      order_regel_id: 1,
      artikelnr: 'BANG21XX230260',
      aantal: 1,
      order_regels: {
        order_id: 1,
        regelnummer: 1,
        artikelnr: 'BANG21XX230260',
        omschrijving: 'BANGKOK KLEUR 21 230x260 cm',
        omschrijving_2: null,
        orderaantal: 1,
        te_leveren: 1,
        gewicht_kg: 12.5,
        is_maatwerk: false,
        maatwerk_lengte_cm: null,
        maatwerk_breedte_cm: null,
        maatwerk_afwerking: null,
        maatwerk_band_kleur: null,
        producten: { omschrijving: 'BANGKOK KLEUR 21 230x260 cm', gewicht_kg: 12.5 },
      },
    },
  ],
  zending_colli: [],
}

for (const taal of ['nl', 'de', 'fr', 'en'] as const) {
  Deno.test(`genereerPakbonPDF: rendert geldige PDF in taal '${taal}'`, async () => {
    const doc = bouwPakbonDocument(ZENDING)
    const bytes = await genereerPakbonPDF(doc, BEDRIJF, undefined, taal)
    assertEquals(bytes[0], 0x25)
    assertEquals(bytes[1], 0x50)
    assertEquals(bytes[2], 0x44)
    assertEquals(bytes[3], 0x46)
    assert(bytes.length > 500, 'PDF te klein — waarschijnlijk leeg')
  })
}

Deno.test('genereerPakbonPDF: default taal blijft nl (backwards-compat)', async () => {
  const doc = bouwPakbonDocument(ZENDING)
  const bytes = await genereerPakbonPDF(doc, BEDRIJF)
  assert(bytes.length > 500)
})
