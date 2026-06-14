// Tests voor de PDF-renderer (ADR-0036 slice 4).

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { bouwFactuurDocument, type FactuurDocumentLookups } from './factuur-document.ts'
import { naarFactuurPdfInput } from './factuur-pdf-renderer.ts'

const FACTUUR = {
  factuur_nr: 'FACT-2026-0001',
  factuurdatum: '2026-06-14',
  debiteur_nr: 123,
  fact_naam: 'Klant BV',
  fact_adres: 'Straat 1',
  fact_postcode: '1234 AB',
  fact_plaats: 'Plaats',
  fact_land: 'NL',
  btw_nummer: 'NL0001',
  subtotaal: '130.00',
  btw_percentage: '21',
  btw_bedrag: '27.30',
  totaal: '157.30',
  btw_verlegd: false,
}

const REGELS = [
  {
    order_id: 10,
    order_regel_id: 50,
    regelnummer: 1,
    artikelnr: 'ART1',
    omschrijving: 'BANGKOK KLEUR 21',
    omschrijving_2: 'Band: PE21',
    uw_referentie: 'PO-9',
    order_nr: 'ORD-2026-0010',
    aantal: '2',
    prijs: '50.00',
    bedrag: '100.00',
    btw_percentage: '21',
  },
]

function lookups(): FactuurDocumentLookups {
  return {
    orderRegels: new Map([[50, { karpi_code: 'BAN21', gewicht_kg: 7.5 }]]),
    producten: new Map(),
    klantArtikelen: new Map(),
  }
}

Deno.test('naarFactuurPdfInput: header overgenomen incl. verlegd', () => {
  const doc = bouwFactuurDocument(FACTUUR, REGELS, lookups(), { vertegenwoordiger: 'Jan', isTestMessage: false })
  const { factuur } = naarFactuurPdfInput(doc)
  assertEquals(factuur.factuur_nr, 'FACT-2026-0001')
  assertEquals(factuur.vertegenwoordiger, 'Jan')
  assertEquals(factuur.subtotaal, 130)
  assertEquals(factuur.btw_verlegd, false)
  assertEquals(factuur.btw_nummer_afnemer, 'NL0001')
  // PDF-specifieke extra's worden door de caller toegevoegd, niet hier.
  assertEquals(factuur.totaal_m2, undefined)
  assertEquals(factuur.totaal_gewicht_kg, undefined)
})

Deno.test('naarFactuurPdfInput: regel-omschrijving = gedeelde artikeltekst', () => {
  const doc = bouwFactuurDocument(FACTUUR, REGELS, lookups(), { vertegenwoordiger: 'Jan', isTestMessage: false })
  const { regels } = naarFactuurPdfInput(doc)
  assertEquals(regels.length, 1)
  assertEquals(regels[0], {
    order_nr: 'ORD-2026-0010',
    uw_referentie: 'PO-9',
    artikelnr: 'ART1',
    aantal: 2,
    eenheid: 'St',
    omschrijving: 'BAN21 BANGKOK KLEUR 21',
    omschrijving_2: 'Band: PE21',
    prijs: 50,
    bedrag: 100,
  })
})
