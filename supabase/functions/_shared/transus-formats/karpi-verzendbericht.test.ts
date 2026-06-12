import { assertEquals, assertThrows } from 'https://deno.land/std@0.220.0/assert/mod.ts';
import {
  buildKarpiVerzendbericht,
  valideerVerzendberichtInput,
  type VerzendberichtInput,
} from './karpi-verzendbericht.ts';

const FIXTURES_DIR = new URL('../../../../docs/transus/voorbeelden/', import.meta.url);

async function loadFixture(name: string): Promise<string> {
  const url = new URL(name, FIXTURES_DIR);
  const bytes = await Deno.readFile(url);
  return new TextDecoder('windows-1252').decode(bytes);
}

function normalizeFixedWidth(raw: string): string {
  return raw.split(/\r?\n/).filter((line) => line.length > 0).join('\r\n');
}

const basis: VerzendberichtInput = {
  zendingNr: 'ZEND-2026-0042',
  verzenddatum: '2026-06-11',
  leverdatum: '2026-06-12',
  orderNumberBuyer: '8MRE0',
  orderNumberSupplier: 'ORD-2026-0334',
  partnerNaam: 'BDSK Handels GmbH',
  senderGln: '8715954999998',
  recipientGln: '9007019010007',
  buyerGln: '9007019015989',
  deliveryPartyGln: '8712423012345',
  isTestMessage: false,
  regels: [
    { regelnummer: 1, gtin: '8715954123456', artikelcode: 'KW123', omschrijving: 'Tapijt', aantal: 2 },
  ],
};

// Gereconstrueerd uit het echte Hornbach NL verzendbericht (bericht-ID 172390327,
// verstuurd door Windows Connect op 2026-06-11). Betekenis per veld gevalideerd
// tegen de EDIFACT-vertaling (edifact-output-desadv-hornbach-172390327.edi).
const hornbachInput: VerzendberichtInput = {
  zendingNr: '00456666', // pakbonnr oud systeem → BGM+351 + RFF+DQ
  verzenddatum: '2026-06-11', // DTM+137
  leverdatum: '2026-06-01', // DTM+2
  orderNumberBuyer: '7270257662', // RFF+ON (klant-PO Hornbach)
  orderNumberSupplier: '26581310', // ordernr oud systeem (Basta)
  partnerNaam: 'Hornbach Baumarkt (NL) B.V.', // afgekapt naar 'Hornbach Bauma' (14)
  senderGln: '8715954999998', // NAD+SU Karpi
  recipientGln: '4306517008994', // UNB-recipient (Transus-routering Hornbach)
  buyerGln: '8717056697277', // NAD+BY (vestiging)
  deliveryPartyGln: '8717056697277', // NAD+DP (vestiging)
  isTestMessage: false,
  regels: [
    {
      regelnummer: 1, // LIN+1
      gtin: '8715954193372', // LIN ...:EN
      artikelcode: '493430001', // eigen Karpi-artikelnr (TEDDY 43)
      omschrijving: 'TEDDY Kleur 43 CA: 060x090 cm',
      aantal: 5, // QTY+12:5:PCE
    },
  ],
};

Deno.test('buildKarpiVerzendbericht - reproduceert Hornbach DESADV fixture 172390327 byte-identiek', async () => {
  const fixture = await loadFixture('verzendbericht-uit-hornbach-172390327.txt');
  const built = buildKarpiVerzendbericht(hornbachInput);

  // Byte-identiek inclusief CRLF-terminators en afsluitende CRLF.
  assertEquals(built, fixture);
  // En via dezelfde normalisatie als de INVOIC-fixture-tests.
  assertEquals(normalizeFixedWidth(built), normalizeFixedWidth(fixture));
});

Deno.test('buildKarpiVerzendbericht - normaliseert RugFlow-nummers naar 8 cijfers', () => {
  const built = buildKarpiVerzendbericht(basis);
  const [header, regel] = built.split(/\r?\n/);

  assertEquals(header.length, 291);
  assertEquals(regel.length, 245);
  assertEquals(header.substring(0, 1), '0');
  assertEquals(header.substring(1, 9), '20260042'); // ZEND-2026-0042 → laatste 8 cijfers
  assertEquals(header.substring(231, 239), '20260334'); // ORD-2026-0334 → laatste 8 cijfers
  assertEquals(header.substring(103, 117), 'BDSK Handels G'); // afgekapt op 14
  assertEquals(regel.substring(0, 1), '1');
  assertEquals(regel.substring(165, 182), '00000000000002.00');
  assertEquals(regel.substring(202, 208), '000001');
  assertEquals(regel.substring(208, 213), '8MRE0'); // klant-PO valt terug op header
});

Deno.test('valideerVerzendberichtInput accepteert volledige input', () => {
  assertEquals(valideerVerzendberichtInput(basis), undefined);
});

Deno.test('valideerVerzendberichtInput gooit bij ontbrekende GLN of lege regels', () => {
  assertThrows(() => valideerVerzendberichtInput({ ...basis, recipientGln: '' }));
  assertThrows(() => valideerVerzendberichtInput({ ...basis, regels: [] }));
});

Deno.test('valideerVerzendberichtInput gooit bij lege leverdatum', () => {
  assertThrows(() => valideerVerzendberichtInput({ ...basis, leverdatum: '' }));
});

Deno.test('valideerVerzendberichtInput gooit bij lege zendingNr of verzenddatum', () => {
  assertThrows(() => valideerVerzendberichtInput({ ...basis, zendingNr: '' }));
  assertThrows(() => valideerVerzendberichtInput({ ...basis, verzenddatum: '' }));
});

Deno.test('valideerVerzendberichtInput gooit bij regel zonder GTIN', () => {
  assertThrows(
    () =>
      valideerVerzendberichtInput({
        ...basis,
        regels: [{ regelnummer: 1, gtin: null, artikelcode: 'KW123', omschrijving: 'Tapijt', aantal: 2 }],
      }),
    Error,
    'mist GTIN',
  );
});
