// Golden-test: bewijst dat de gedeelde EDI-renderer dezelfde KarpiInvoiceInput
// produceert als de huidige automatische buildEdiFactuurInput (ADR-0036 slice 3).
// De verwachte waarden zijn handmatig opgebouwd uit de verbatim-geëxtraheerde
// mapping; afwijking = onbedoelde drift.

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { bouwFactuurDocument, type FactuurDocumentLookups } from './factuur-document.ts'
import { naarInvoiceInput, type FactuurInvoiceContext } from './factuur-invoice-renderer.ts'
import { buildKarpiInvoiceFixedWidth } from '../transus-formats/karpi-invoice-fixed-width.ts'

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
    omschrijving: 'BANGKOK',
    omschrijving_2: 'Band PE21',
    uw_referentie: 'PO-9',
    order_nr: 'ORD-2026-0010',
    aantal: '2',
    prijs: '50.00',
    bedrag: '100.00',
    btw_percentage: '21',
  },
  {
    order_id: 10,
    order_regel_id: 51,
    regelnummer: 2,
    artikelnr: 'ART2',
    omschrijving: null,
    omschrijving_2: null,
    uw_referentie: null,
    order_nr: 'ORD-2026-0010',
    aantal: '1',
    prijs: '30.00',
    bedrag: '30.00',
    btw_percentage: '21',
  },
]

function lookups(): FactuurDocumentLookups {
  const orderRegels = new Map([[50, { karpi_code: 'BAN21', gewicht_kg: 7.5 }]])
  const producten = new Map([
    ['ART1', { karpi_code: null, omschrijving: null, omschrijving_2: null, ean_code: '8712345678901', gewicht_kg: null }],
    ['ART2', { karpi_code: null, omschrijving: 'MAT', omschrijving_2: null, ean_code: null, gewicht_kg: 4 }],
  ])
  const klantArtikelen = new Map([['ART1', { klant_artikel: 'KL-77', omschrijving: null }]])
  return { orderRegels, producten, klantArtikelen, klantEigenNamen: new Map() }
}

const CTX: FactuurInvoiceContext = {
  bedrijf: {
    bedrijfsnaam: 'KARPI GROUP HOME FASHION B.V.',
    gln_eigen: '8715954999998',
    adres: 'TWEEDE BROEKDIJK 10',
    postcode: '7122 LB',
    plaats: 'AALTEN',
    land: 'NL',
    btw_nummer: 'NL8888',
  },
  debiteur: {
    naam: 'Klant BV Debiteur',
    btw_nummer: 'NL0002',
    fact_naam: null,
    fact_adres: null,
    fact_postcode: null,
    fact_plaats: null,
    land: 'NL',
    gln_bedrijf: '9999999999999',
  },
  orders: [
    {
      id: 10,
      order_nr: 'ORD-2026-0010',
      oud_order_nr: null,
      orderdatum: '2026-06-01',
      klant_referentie: 'KREF',
      bes_naam: null,
      bes_adres: null,
      bes_postcode: null,
      bes_plaats: null,
      bes_land: null,
      afl_naam: 'Aflever BV',
      afl_naam_2: null,
      afl_adres: 'Aflstraat 2',
      afl_postcode: '5678 CD',
      afl_plaats: 'Aflstad',
      afl_land: 'NL',
      factuuradres_gln: '1111111111111',
      besteller_gln: null,
      afleveradres_gln: '2222222222222',
    },
  ],
  deliveryNoteNumber: 'FACT-2026-0001',
}

Deno.test('naarInvoiceInput: volledige KarpiInvoiceInput (golden, niet-verlegd)', () => {
  const doc = bouwFactuurDocument(FACTUUR, REGELS, lookups(), {
    vertegenwoordiger: 'Jan',
    isTestMessage: false,
  })
  const out = naarInvoiceInput(doc, CTX)

  assertEquals(out, {
    invoiceDate: '2026-06-14',
    invoiceNumber: 'FACT-2026-0001',
    customerShortName: 'Klant BV Debiteur',
    recipientGln: '1111111111111',
    orderNumberBuyer: 'PO-9',
    orderDate: '2026-06-01',
    deliveryNoteNumber: 'FACT-2026-0001',
    supplierOrderNumber: 'ORD-2026-0010',
    vatAmount: 27.3,
    isTestMessage: false,
    supplier: {
      name: 'KARPI GROUP HOME FASHION B.V.',
      gln: '8715954999998',
      address: 'TWEEDE BROEKDIJK 10',
      postcode: '7122 LB',
      city: 'AALTEN',
      country: 'NL',
      vatNumber: 'NL8888',
    },
    invoicee: {
      name: 'Klant BV',
      gln: '9999999999999', // NAD+IV = debiteur.gln_bedrijf (facturatie-entiteit), niet factuuradres_gln (routering)
      address: 'Straat 1',
      postcode: '1234 AB',
      city: 'Plaats',
      country: 'NL',
      vatNumber: 'NL0001',
    },
    deliveryParty: {
      name: 'Aflever BV',
      name2: null,
      gln: '2222222222222',
      address: 'Aflstraat 2',
      postcode: '5678 CD',
      city: 'Aflstad',
      country: 'NL',
      vatNumber: 'NL0001',
    },
    buyer: {
      name: 'Aflever BV',
      gln: '2222222222222',
      address: 'Aflstraat 2',
      postcode: '5678 CD',
      city: 'Aflstad',
      country: 'NL',
      vatNumber: 'NL0001',
    },
    lines: [
      {
        lineNumber: 1,
        supplierArticleNumber: 'ART1',
        articleDescription: 'BAN21 BANGKOK',
        deliveryNoteNumber: 'FACT-2026-0001',
        gtin: '8712345678901',
        quantity: 2,
        invoiceNumber: 'FACT-2026-0001',
        netPrice: 50,
        orderNumberBuyer: 'PO-9',
        buyerArticleNumber: 'KL-77',
        lineAmount: 100,
        taxableAmount: 100,
        vatAmount: 21,
        packageQuantity: 2,
        weightKg: 7.5,
        vatPercentage: 21,
      },
      {
        lineNumber: 2,
        supplierArticleNumber: 'ART2',
        articleDescription: 'ART2 MAT',
        deliveryNoteNumber: 'FACT-2026-0001',
        gtin: '',
        quantity: 1,
        invoiceNumber: 'FACT-2026-0001',
        netPrice: 30,
        orderNumberBuyer: 'KREF',
        buyerArticleNumber: '',
        lineAmount: 30,
        taxableAmount: 30,
        vatAmount: 6.3,
        packageQuantity: 1,
        weightKg: 4,
        vatPercentage: 21,
      },
    ],
  })
})

Deno.test('naarInvoiceInput: verlegd → 0% op alle regels', () => {
  const doc = bouwFactuurDocument({ ...FACTUUR, btw_verlegd: true }, REGELS, lookups(), {
    vertegenwoordiger: 'Jan',
    isTestMessage: false,
  })
  const out = naarInvoiceInput(doc, CTX)
  assertEquals(out.lines.map((l) => l.vatPercentage), [0, 0])
  assertEquals(out.lines.map((l) => l.vatAmount), [0, 0])
})

Deno.test('naarInvoiceInput → fixed-width builder draait zonder fout', () => {
  // De INVOIC-builder eist GTIN op élke regel (zelfde eis als de oude mapper) —
  // geef beide regels een EAN zodat dit een realistische volledige factuur is.
  const volledig = lookups()
  volledig.producten.set('ART2', {
    karpi_code: null,
    omschrijving: 'MAT',
    omschrijving_2: null,
    ean_code: '8712345678902',
    gewicht_kg: 4,
  })
  const doc = bouwFactuurDocument(FACTUUR, REGELS, volledig, {
    vertegenwoordiger: 'Jan',
    isTestMessage: false,
  })
  const tekst = buildKarpiInvoiceFixedWidth(naarInvoiceInput(doc, CTX))
  // De builder heeft een eigen byte-test; hier alleen: renderer-output voedt 'm
  // zonder fout en levert een gevulde INVOIC (minstens de header-record).
  assertEquals(tekst.length >= 1107, true)
})

Deno.test('naarInvoiceInput: NAD+IV = gln_bedrijf, routering = factuuradres_gln (Hornbach centrale facturatie)', () => {
  const doc = bouwFactuurDocument(FACTUUR, REGELS, lookups(), { vertegenwoordiger: 'Jan', isTestMessage: false })
  // Hornbach: Transus levert de interchange-GLN in gln_gefactureerd → factuuradres_gln
  // = routering; gln_bedrijf = de echte invoicee (met .0-importartefact).
  const ctx: FactuurInvoiceContext = {
    ...CTX,
    debiteur: { ...CTX.debiteur, gln_bedrijf: '8717056697390.0' },
    orders: [{ ...CTX.orders[0], factuuradres_gln: '4306517008994' }],
  }
  const out = naarInvoiceInput(doc, ctx)
  assertEquals(out.invoicee.gln, '8717056697390') // NAD+IV = facturatie-entiteit, .0 gestript
  assertEquals(out.recipientGln, '4306517008994') // UNB-routering blijft de interchange-GLN
})

Deno.test('naarInvoiceInput: ontbrekende GLN gooit', () => {
  const doc = bouwFactuurDocument(FACTUUR, REGELS, lookups(), {
    vertegenwoordiger: 'Jan',
    isTestMessage: false,
  })
  const ctxGeenGln: FactuurInvoiceContext = {
    ...CTX,
    debiteur: { ...CTX.debiteur, gln_bedrijf: null },
    orders: [{ ...CTX.orders[0], factuuradres_gln: null, besteller_gln: null, afleveradres_gln: null }],
  }
  let gooide = false
  try {
    naarInvoiceInput(doc, ctxGeenGln)
  } catch {
    gooide = true
  }
  assertEquals(gooide, true)
})
