import { assertEquals, assertThrows } from 'https://deno.land/std@0.220.0/assert/mod.ts';
import {
  buildKarpiInvoiceFixedWidth,
  type KarpiInvoiceInput,
} from './karpi-invoice-fixed-width.ts';

const FIXTURES_DIR = new URL('../../../../docs/transus/voorbeelden/', import.meta.url);

async function loadFixture(name: string): Promise<string> {
  const url = new URL(name, FIXTURES_DIR);
  const bytes = await Deno.readFile(url);
  return new TextDecoder('windows-1252').decode(bytes);
}

function normalizeFixedWidth(raw: string): string {
  return raw.split(/\r?\n/).filter((line) => line.length > 0).join('\r\n');
}

const bdskInvoiceInput: KarpiInvoiceInput = {
  invoiceDate: '2026-04-03',
  invoiceNumber: '26039533',
  customerShortName: 'BDSK Handels G',
  recipientGln: '9007019010007',
  orderNumberBuyer: 'AND9IJ',
  orderDate: '2026-02-27',
  deliveryNoteNumber: '0451006',
  supplierOrderNumber: '26494260',
  vatAmount: 0,
  supplier: {
    name: 'KARPI GROUP HOME FASHION B.V.',
    gln: '8715954999998',
    address: 'TWEEDE BROEKDIJK 10',
    postcode: '7122 LB',
    city: 'AALTEN',
    country: 'NL',
  },
  buyer: {
    name: 'XXXLUTZ ASCHHEIM',
    gln: '9007019006864',
    address: 'EICHENDORFERSTRASSE 40',
    postcode: '85609',
    city: 'ASCHHEIM',
    country: 'DE',
  },
  invoicee: {
    name: 'BDSK HANDELS',
    name2: 'GMBH & CO. KG @',
    gln: '9007019015989',
    address: 'MERGENTHEIMER STR. 59',
    postcode: '97084',
    city: 'WUERZBURG',
    country: 'DE',
    vatNumber: 'DE279448078',
  },
  deliveryParty: {
    name: 'SC-LU ANZING',
    name2: 'XXXLUTZ',
    gln: '9007019010298',
    address: 'GEWERBEPARK 12',
    postcode: '85646',
    city: 'ANZING',
    country: 'DE',
  },
  lines: [
    {
      lineNumber: 1,
      supplierArticleNumber: '838430031',
      articleDescription: 'LENA43XX160230 LENA Farbe 43 CA: 160x230 cm',
      gtin: '8715954191149',
      quantity: 1,
      netPrice: 68.59,
      buyerArticleNumber: '40630068.64',
      lineAmount: 68.59,
      weightKg: 7,
    },
  ],
};

Deno.test('buildKarpiInvoiceFixedWidth - reproduceert BDSK factuur fixture 166794659', async () => {
  const fixture = await loadFixture('factuur-uit-bdsk-166794659.txt');
  const built = buildKarpiInvoiceFixedWidth(bdskInvoiceInput);

  assertEquals(normalizeFixedWidth(built), normalizeFixedWidth(fixture));
});

Deno.test('buildKarpiInvoiceFixedWidth - reproduceert BDSK factuur fixture 168849861', async () => {
  const fixture = await loadFixture('factuur-uit-bdsk-168849861.txt');
  const built = buildKarpiInvoiceFixedWidth({
    ...bdskInvoiceInput,
    invoiceDate: '2026-04-29',
    invoiceNumber: '26040215',
    customerShortName: null,
    recipientGln: '9007019015989',
    orderNumberBuyer: 'NAXC5J',
    orderDate: '2026-04-15',
    deliveryNoteNumber: '0451809',
    supplierOrderNumber: '26542580',
    buyer: {
      name: 'XXXLUTZ',
      gln: '9007019003702',
      address: 'INGOLSTAEDTERSTRASSE 20-22',
      postcode: '90461',
      city: 'NUERNBERG',
      country: 'DE',
    },
    deliveryParty: {
      name: 'XXXLUTZ',
      name2: '9007019003702',
      gln: '9007019003702',
      address: 'INGOLSTAEDTERSTRASSE 20-22',
      postcode: '90461',
      city: 'NUERNBERG',
      country: 'DE',
    },
    lines: [
      {
        lineNumber: 1,
        supplierArticleNumber: '526450094',
        articleDescription: 'PATS45XX080300 PATCH Farbe 45 CA: 080x300 cm',
        gtin: '8715954145982',
        quantity: 1,
        netPrice: 59.46,
        buyerArticleNumber: '40630025.99',
        lineAmount: 59.46,
        weightKg: 3,
      },
    ],
  });

  assertEquals(normalizeFixedWidth(built), normalizeFixedWidth(fixture));
});

Deno.test('buildKarpiInvoiceFixedWidth - normaliseert RugFlow factuurnummers naar 8 cijfers', () => {
  const built = buildKarpiInvoiceFixedWidth({
    ...bdskInvoiceInput,
    invoiceNumber: 'FACT-2026-0001',
    deliveryNoteNumber: 'ZEND-2026-0001',
    supplierOrderNumber: 'ORD-2026-0001',
    lines: [
      {
        ...bdskInvoiceInput.lines[0],
        invoiceNumber: 'FACT-2026-0001',
      },
    ],
  });
  const [header, line] = built.split(/\r?\n/);

  assertEquals(header.substring(38, 46), '20260001');
  assertEquals(header.substring(316, 323), '0260001');
  assertEquals(header.substring(456, 464), '20260001');
  assertEquals(line.substring(159, 167), '20260001');
});

Deno.test('buildKarpiInvoiceFixedWidth - gooit bij ontbrekende verplichte GLN', () => {
  assertThrows(
    () =>
      buildKarpiInvoiceFixedWidth({
        ...bdskInvoiceInput,
        buyer: { ...bdskInvoiceInput.buyer, gln: '' },
      }),
    Error,
    'buyer.gln',
  );
});
