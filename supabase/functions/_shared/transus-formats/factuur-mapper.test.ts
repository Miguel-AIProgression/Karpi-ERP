import { assertEquals, assertThrows } from 'https://deno.land/std@0.220.0/assert/mod.ts';
import { mapFactuurNaarInvoiceInput, type FactuurEdiData } from './factuur-mapper.ts';
import { buildKarpiInvoiceFixedWidth } from './karpi-invoice-fixed-width.ts';

function baseData(overrides: Partial<FactuurEdiData> = {}): FactuurEdiData {
  return {
    factuur: { factuur_nr: 'FACT-2026-0001', factuurdatum: '2026-06-01', btw_bedrag: 21 },
    order: {
      order_nr: 'ORD-2026-0042',
      orderdatum: '2026-05-20',
      klant_referentie: 'PO-12345',
      btw_nummer: 'NL1234',
      besteller: {
        naam: 'XXXLUTZ ASCHHEIM', adres: 'EICHENDORFERSTR 40',
        postcode: '85609', plaats: 'ASCHHEIM', land: 'DE', gln: '9007019006864',
      },
      factuuradres: {
        naam: 'BDSK HANDELS', adres: 'HAUPTSTR 1',
        postcode: '12345', plaats: 'WUERSELEN', land: 'DE', gln: '9007019015989',
      },
      afleveradres: {
        naam: 'XXXLUTZ FILIAAL', adres: 'EICHENDORFERSTR 40',
        postcode: '85609', plaats: 'ASCHHEIM', land: 'DE', gln: '9007019005430',
      },
    },
    supplier: {
      name: 'KARPI GROUP HOME FASHION B.V.', gln: '8715954999998',
      address: 'TWEEDE BROEKDIJK 10', postcode: '7122 LB', city: 'AALTEN', country: 'Nederland',
    },
    debiteur: { naam: 'BDSK Handels GmbH', btw_nummer: 'DE999', btw_verlegd_intracom: false },
    deliveryNoteNumber: '0451006',
    isTestMessage: false,
    regels: [
      {
        regelnummer: 1, artikelnr: '526230180', omschrijving: 'MARICH 160x230',
        aantal: 2, prijs: 50, bedrag: 100, btw_percentage: 21, gtin: '8715954123456',
      },
    ],
    ...overrides,
  };
}

Deno.test('mapt kernvelden uit factuur + order', () => {
  const out = mapFactuurNaarInvoiceInput(baseData());
  assertEquals(out.invoiceNumber, 'FACT-2026-0001');
  assertEquals(out.invoiceDate, '2026-06-01');
  assertEquals(out.supplierOrderNumber, 'ORD-2026-0042'); // ons ordernr
  assertEquals(out.orderNumberBuyer, 'PO-12345'); // klant-PO
  assertEquals(out.deliveryNoteNumber, '0451006');
  assertEquals(out.lines.length, 1);
  assertEquals(out.lines[0].gtin, '8715954123456');
});

Deno.test('normaliseert land naar ISO alpha-2', () => {
  const out = mapFactuurNaarInvoiceInput(baseData());
  assertEquals(out.supplier.country, 'NL'); // "Nederland" → NL
  assertEquals(out.buyer.country, 'DE'); // al 'DE'
});

Deno.test('BTW-verlegd intracom → 0% op alle regels', () => {
  const out = mapFactuurNaarInvoiceInput(
    baseData({ debiteur: { naam: 'X', btw_nummer: null, btw_verlegd_intracom: true } }),
  );
  assertEquals(out.lines[0].vatPercentage, 0);
  assertEquals(out.lines[0].vatAmount, 0);
});

Deno.test('niet-verlegd → btw% en btw-bedrag per regel afgeleid', () => {
  const out = mapFactuurNaarInvoiceInput(baseData());
  assertEquals(out.lines[0].vatPercentage, 21);
  assertEquals(out.lines[0].vatAmount, 21); // 100 * 21%
});

Deno.test('bes_* leeg → buyer valt terug op invoicee (factuuradres)', () => {
  const data = baseData();
  data.order.besteller = { naam: null, adres: null, postcode: null, plaats: null, land: null, gln: null };
  const out = mapFactuurNaarInvoiceInput(data);
  assertEquals(out.buyer.name, out.invoicee.name);
  assertEquals(out.buyer.gln, out.invoicee.gln);
});

Deno.test('invoicee erft btw-nummer van order, anders debiteur', () => {
  const out = mapFactuurNaarInvoiceInput(baseData());
  assertEquals(out.invoicee.vatNumber, 'NL1234'); // order.btw_nummer wint
  const data = baseData();
  data.order.btw_nummer = null;
  assertEquals(mapFactuurNaarInvoiceInput(data).invoicee.vatNumber, 'DE999'); // fallback debiteur
});

Deno.test('regel zonder GTIN → throw met artikelnr', () => {
  const data = baseData();
  data.regels[0].gtin = null;
  assertThrows(() => mapFactuurNaarInvoiceInput(data), Error, '526230180');
});

Deno.test('output is bouwbaar tot een geldig fixed-width bericht', () => {
  // Integratie: mapper-output moet door de builder-validatie komen.
  const out = mapFactuurNaarInvoiceInput(baseData());
  const raw = buildKarpiInvoiceFixedWidth(out);
  const lines = raw.split('\r\n').filter((l) => l.length > 0);
  assertEquals(lines[0][0], '0'); // header record type
  assertEquals(lines[1][0], '2'); // article record type
});
