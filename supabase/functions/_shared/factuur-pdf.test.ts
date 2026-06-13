// Deno test: `deno test --allow-net supabase/functions/_shared/factuur-pdf.test.ts`
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { genereerFactuurPDF, type FactuurPDFInput } from './factuur-pdf.ts'

const MINIMAL_INPUT: FactuurPDFInput = {
  bedrijf: {
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
    iban: 'NL37INGB0689412401',
    bic: 'INGBNL2A',
    bank: 'ING Bank',
    rekeningnummer: '689412401',
    betalingscondities_tekst: '30 dagen netto',
  },
  factuur: {
    factuur_nr: 'FACT-2026-0001',
    factuurdatum: '2026-04-22',
    debiteur_nr: 260000,
    vertegenwoordiger: 'Niet van Toepassing',
    fact_naam: 'FLOORPASSION',
    fact_adres: 'BILTSTRAAT 35G',
    fact_postcode: '3572 AC',
    fact_plaats: 'UTRECHT',
    subtotaal: 100,
    btw_percentage: 21,
    btw_bedrag: 21,
    totaal: 121,
  },
  regels: [
    {
      order_nr: 'ORD-2026-0001',
      uw_referentie: 'FPNL000001',
      artikelnr: 'BANG21MAATWERK',
      aantal: 1,
      eenheid: 'St',
      omschrijving: 'BANG21XX230260',
      omschrijving_2: 'BANGKOK KLEUR 21 ca: 230x260 cm',
      prijs: 100,
      bedrag: 100,
    },
  ],
}

Deno.test('genereerFactuurPDF: produceert geldige PDF (magic bytes)', async () => {
  const bytes = await genereerFactuurPDF(MINIMAL_INPUT)
  // PDF-magic: %PDF
  assertEquals(bytes[0], 0x25)
  assertEquals(bytes[1], 0x50)
  assertEquals(bytes[2], 0x44)
  assertEquals(bytes[3], 0x46)
  assert(bytes.length > 500, 'PDF te klein — waarschijnlijk leeg')
})

Deno.test('genereerFactuurPDF: handelt 50 regels af (paginering)', async () => {
  const veelRegels = Array.from({ length: 50 }, (_, i) => ({
    order_nr: `ORD-2026-${String(i).padStart(4, '0')}`,
    uw_referentie: `REF${i}`,
    artikelnr: 'X',
    aantal: 1,
    eenheid: 'St',
    omschrijving: `Regel ${i}`,
    prijs: 10,
    bedrag: 10,
  }))
  const bytes = await genereerFactuurPDF({ ...MINIMAL_INPUT, regels: veelRegels })
  assert(bytes.length > 1000)
})

Deno.test('genereerFactuurPDF: 0% BTW werkt (intracom/export)', async () => {
  const input = {
    ...MINIMAL_INPUT,
    factuur: {
      ...MINIMAL_INPUT.factuur,
      btw_percentage: 0,
      btw_bedrag: 0,
      totaal: 100,
    },
  }
  const bytes = await genereerFactuurPDF(input)
  assert(bytes.length > 500)
})

Deno.test('genereerFactuurPDF: totaal m2 + gewicht regel rendert', async () => {
  const input: FactuurPDFInput = {
    ...MINIMAL_INPUT,
    factuur: {
      ...MINIMAL_INPUT.factuur,
      totaal_m2: 546.14,
      totaal_gewicht_kg: 1420.18,
    },
  }
  const bytes = await genereerFactuurPDF(input)
  assert(bytes.length > 500, 'PDF met totaal m2/gewicht moet renderen')
})

Deno.test('genereerFactuurPDF: multi-line omschrijving_2 (Band:, Uw model:)', async () => {
  const input: FactuurPDFInput = {
    ...MINIMAL_INPUT,
    regels: [
      {
        order_nr: 'ORD-2026-0001',
        uw_referentie: 'FPNL000001',
        artikelnr: 'DANT13MAATWERK',
        aantal: 1,
        eenheid: 'St',
        omschrijving: 'DANT13D1375RND',
        omschrijving_2: 'DANTE KLEUR 13 ca: 375cm RND\nBand: DA12\nUw model:LUXOR',
        prijs: 459.14,
        bedrag: 459.14,
      },
    ],
  }
  const bytes = await genereerFactuurPDF(input)
  assert(bytes.length > 500, 'PDF met 3 omschrijving-regels moet renderen')
})

Deno.test('genereerFactuurPDF: afwijkend afleveradres-blok rendert', async () => {
  const input: FactuurPDFInput = {
    ...MINIMAL_INPUT,
    regels: [
      {
        order_nr: 'ORD-2026-0001',
        uw_referentie: 'FPNL000001',
        artikelnr: 'BANG21MAATWERK',
        aantal: 1,
        eenheid: 'St',
        omschrijving: 'BANG21XX230260',
        omschrijving_2: 'BANGKOK KLEUR 21 ca: 230x260 cm',
        prijs: 100,
        bedrag: 100,
        afleveradres: {
          naam: 'FLOORPASSION DE',
          adres: 'MUSTERSTRASSE 12',
          postcode: '40213',
          plaats: 'DUSSELDORF',
        },
      },
    ],
  }
  const bytes = await genereerFactuurPDF(input)
  assert(bytes.length > 500, 'PDF met afleveradres-blok moet renderen')
})

Deno.test('genereerFactuurPDF: lange korting-omschrijving wrapt naar 2e regel (geen ellips-afkapping)', async () => {
  const input: FactuurPDFInput = {
    ...MINIMAL_INPUT,
    regels: [
      {
        order_nr: 'ORD-2026-2057',
        uw_referentie: '',
        artikelnr: 'DREMPELKORTING',
        aantal: 1,
        eenheid: 'St',
        // 40-tekens omschrijving — past niet naast de prijs in Courier 9pt
        omschrijving: 'Drempelkorting verzending — vanaf €35.00',
        prijs: -35,
        bedrag: -35,
      },
      {
        order_nr: 'ORD-2026-2058',
        uw_referentie: '',
        artikelnr: 'BUNDELKORTING',
        aantal: 1,
        eenheid: 'St',
        omschrijving: 'Bundelkorting verzending (gebundeld 2 orders)',
        prijs: -35,
        bedrag: -35,
      },
    ],
  }
  const bytes = await genereerFactuurPDF(input)
  assert(bytes.length > 500, 'PDF met gewrapte korting-omschrijvingen moet renderen')
})

Deno.test('genereerFactuurPDF: dubbele bankregel + 3-talige voorwaarden-footer', async () => {
  const input: FactuurPDFInput = {
    ...MINIMAL_INPUT,
    bedrijf: {
      ...MINIMAL_INPUT.bedrijf,
      bank2: {
        bank: 'Commerzbank AG Bocholt',
        rekeningnummer: '341011500',
        blz: '42840005',
        bic: 'COBADEFFXXX',
        iban: 'DE32428400050341011500',
      },
      voorwaarden_nl: 'Al onze offertes, verkopen en leveringen geschieden uitsluitend overeenkomstig onze Algemene Leverings- en Betalingsvoorwaarden.',
      voorwaarden_de: 'Alle unsere Angebote, Verkäufe und Lieferungen geschehen gemäss unseren Allgemeinen Lieferungs- und Zahlungsbedingungen.',
      voorwaarden_en: 'All our offers, sales and deliveries are subject to our general terms and conditions of payment.',
    },
  }
  const bytes = await genereerFactuurPDF(input)
  assert(bytes.length > 500, 'PDF met 2 banken en 3-talige voorwaarden moet renderen')
})

Deno.test('genereerFactuurPDF: BTW verlegd — vermelding i.p.v. BTW-regel', async () => {
  const input: FactuurPDFInput = {
    ...MINIMAL_INPUT,
    factuur: {
      ...MINIMAL_INPUT.factuur,
      btw_percentage: 0,
      btw_bedrag: 0,
      totaal: 100,
      btw_verlegd: true,
      btw_nummer_afnemer: 'DE123456789',
    },
  }
  const bytes = await genereerFactuurPDF(input)
  assert(bytes.length > 500, 'PDF met BTW-verlegd-blok moet renderen')
})

Deno.test('genereerFactuurPDF: BTW verlegd zonder btw-nummer afnemer rendert ook', async () => {
  const input: FactuurPDFInput = {
    ...MINIMAL_INPUT,
    factuur: {
      ...MINIMAL_INPUT.factuur,
      btw_percentage: 0,
      btw_bedrag: 0,
      totaal: 100,
      btw_verlegd: true,
      btw_nummer_afnemer: null,
    },
  }
  const bytes = await genereerFactuurPDF(input)
  assert(bytes.length > 500, 'PDF met kale BTW-verlegd-vermelding (zonder btw-nr) moet renderen')
})
