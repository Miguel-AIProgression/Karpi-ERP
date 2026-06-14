// Tests voor de pure FactuurDocument-builder (ADR-0036 slice 2).

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import {
  bouwFactuurDocument,
  type FactuurDocumentFactuurRow,
  type FactuurDocumentLookups,
  type FactuurDocumentRegelRow,
} from './factuur-document.ts'

function leegLookups(): FactuurDocumentLookups {
  return { orderRegels: new Map(), producten: new Map(), klantArtikelen: new Map() }
}

const FACTUUR: FactuurDocumentFactuurRow = {
  factuur_nr: 'FACT-2026-0001',
  factuurdatum: '2026-06-14',
  debiteur_nr: 123,
  fact_naam: 'Klant BV',
  fact_adres: 'Straat 1',
  fact_postcode: '1234 AB',
  fact_plaats: 'Plaats',
  fact_land: 'NL',
  btw_nummer: 'NL0001',
  subtotaal: '100.00',
  btw_percentage: '21',
  btw_bedrag: '21.00',
  totaal: '121.00',
  btw_verlegd: false,
}

const REGEL: FactuurDocumentRegelRow = {
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
}

Deno.test('header: factuur-velden + verlegd-snapshot doorgezet', () => {
  const doc = bouwFactuurDocument(FACTUUR, [REGEL], leegLookups(), {
    vertegenwoordiger: 'Jan',
    isTestMessage: false,
  })
  assertEquals(doc.header.factuur_nr, 'FACT-2026-0001')
  assertEquals(doc.header.vertegenwoordiger, 'Jan')
  assertEquals(doc.header.subtotaal, 100)
  assertEquals(doc.header.totaal, 121)
  assertEquals(doc.header.btw_verlegd, false)
  assertEquals(doc.header.btw_nummer_afnemer, 'NL0001')
})

Deno.test('regel: presentatie wordt per regel opgelost en gewired', () => {
  const lookups = leegLookups()
  lookups.orderRegels.set(50, { karpi_code: 'BAN21', gewicht_kg: 7.5 })
  lookups.klantArtikelen.set('ART1', { klant_artikel: 'KL-77', omschrijving: null })

  const doc = bouwFactuurDocument(FACTUUR, [REGEL], lookups, {
    vertegenwoordiger: 'Jan',
    isTestMessage: false,
  })
  const r = doc.regels[0]
  assertEquals(r.artikelnr, 'ART1')
  assertEquals(r.eenheid, 'St')
  assertEquals(r.aantal, 2)
  assertEquals(r.presentatie.karpi_code, 'BAN21')
  assertEquals(r.presentatie.klant_artikel, 'KL-77')
  assertEquals(r.presentatie.gewicht_kg, 7.5)
  assertEquals(r.presentatie.artikel_tekst, 'BAN21 BANGKOK KLEUR 21')
})

Deno.test('effectief BTW: verlegd-snapshot zet alle regels op 0%', () => {
  const verlegdFactuur = { ...FACTUUR, btw_verlegd: true }
  const doc = bouwFactuurDocument(verlegdFactuur, [REGEL], leegLookups(), {
    vertegenwoordiger: 'Jan',
    isTestMessage: false,
  })
  assertEquals(doc.header.btw_verlegd, true)
  assertEquals(doc.regels[0].btw_percentage, 0)
})

Deno.test('effectief BTW: niet-verlegd behoudt regel-tarief', () => {
  const doc = bouwFactuurDocument(FACTUUR, [REGEL], leegLookups(), {
    vertegenwoordiger: 'Jan',
    isTestMessage: false,
  })
  assertEquals(doc.regels[0].btw_percentage, 21)
})

Deno.test('isTestMessage doorgezet', () => {
  const doc = bouwFactuurDocument(FACTUUR, [REGEL], leegLookups(), {
    vertegenwoordiger: 'Jan',
    isTestMessage: true,
  })
  assertEquals(doc.isTestMessage, true)
})
