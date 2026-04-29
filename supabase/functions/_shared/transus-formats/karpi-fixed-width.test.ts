// Tests voor Karpi fixed-width parser tegen drie productie-voorbeelden van 2026-04-29.
// Deno test runner: `deno test supabase/functions/_shared/transus-formats/`

import { assertEquals, assertExists, assert } from 'https://deno.land/std@0.220.0/assert/mod.ts';
import { parseKarpiOrder, isTestMessage, detectBerichttype } from './karpi-fixed-width.ts';

const FIXTURES_DIR = new URL('../../../../docs/transus/voorbeelden/', import.meta.url);

async function loadFixture(name: string): Promise<string> {
  const url = new URL(name, FIXTURES_DIR);
  const bytes = await Deno.readFile(url);
  // Bestanden zijn cp1252; decoder maps 1:1 naar Unicode voor onze parser.
  return new TextDecoder('windows-1252').decode(bytes);
}

Deno.test('parseKarpiOrder — Ostermann bericht 168818626 (rich, 23 regels)', async () => {
  const raw = await loadFixture('order-in-ostermann-168818626.inh');

  assertEquals(detectBerichttype(raw), 'order');

  const order = parseKarpiOrder(raw);

  // Header
  assertEquals(order.header.ordernummer, '110840413000');
  assertEquals(order.header.orderdatum, '2026-04-29');
  assertEquals(order.header.afnemer_naam, 'Einrichtungsha');
  assertEquals(order.header.gln_gefactureerd, '4260217580016'); // Ostermann HQ Witten
  assertEquals(order.header.gln_besteller, '4260217580146');    // Filiaal Leverkusen
  assertEquals(order.header.gln_afleveradres, '4260217580146'); // idem
  assertEquals(order.header.gln_leverancier, '8715954999998');  // Karpi
  assertEquals(order.header.vlaggen, 'NNNNNNNNNNN');
  assertEquals(order.header.test_flag, 'N');
  assertEquals(isTestMessage(order.header), false);
  assertEquals(order.header.leverdatum, null); // Ostermann's order had geen specifieke leverdatum

  // Regels
  assertEquals(order.regels.length, 23);

  // Eerste regel — Teppich DELICATE 65 155x230
  assertEquals(order.regels[0].regelnummer, 1000);
  assertEquals(order.regels[0].gtin, '8715954211625');
  assertEquals(order.regels[0].artikelcode, '526650044 155x230');
  assertEquals(order.regels[0].aantal, 1);
  assertEquals(order.regels[0].ordernummer_ref, '110840413000');

  // Regel met aantal=2 (LOBO23XX067130)
  const lobo = order.regels.find((r) => r.gtin === '8715954252727');
  assertExists(lobo);
  assertEquals(lobo!.aantal, 2);
  assertEquals(lobo!.regelnummer, 7000);

  // Laatste regel
  assertEquals(order.regels[22].regelnummer, 23000);
  assertEquals(order.regels[22].gtin, '8715954256794');
});

Deno.test('parseKarpiOrder — BDSK bericht 168766180 (sparse, 1 regel, leverdatum)', async () => {
  const raw = await loadFixture('order-in-bdsk-168766180.inh');

  assertEquals(detectBerichttype(raw), 'order');

  const order = parseKarpiOrder(raw);

  // Header
  assertEquals(order.header.ordernummer, 'WMZCGB');
  assertEquals(order.header.orderdatum, '2026-04-28');
  assertEquals(order.header.leverdatum, '2026-05-22'); // Pos 44-52 wel gevuld
  assertEquals(order.header.afnemer_naam, null);       // BDSK stuurt geen naam
  assertEquals(order.header.gln_gefactureerd, '9007019015989'); // BDSK HQ Würzburg
  assertEquals(order.header.gln_besteller, '9009852030365');    // XXXLUTZ Wuerselen
  assertEquals(order.header.gln_afleveradres, '9009852030365'); // idem
  assertEquals(order.header.gln_leverancier, '8715954999998');  // Karpi
  assertEquals(isTestMessage(order.header), false);

  // Regel
  assertEquals(order.regels.length, 1);
  assertEquals(order.regels[0].regelnummer, 1);
  assertEquals(order.regels[0].gtin, '8715954176047');
  assertEquals(order.regels[0].artikelcode, 'PATCH');
  assertEquals(order.regels[0].aantal, 1);
  assertEquals(order.regels[0].ordernummer_ref, 'WMZCGB');
});

Deno.test('parseKarpiOrder — gooit error bij verkeerde header-lengte', () => {
  const corrupt = '0SHORT\n';
  let threw = false;
  try {
    parseKarpiOrder(corrupt);
  } catch (e) {
    threw = true;
    assert(e instanceof Error);
    assert(e.message.includes('header'));
  }
  assertEquals(threw, true);
});

Deno.test('detectBerichttype — fixed-width factuur wordt nog niet herkend (V1 alleen orders)', async () => {
  const raw = await loadFixture('factuur-uit-bdsk-166794659.txt');
  // Factuur start ook met '0' maar heeft een ander veldenpatroon en lengte.
  // V1: alleen 'order' herkennen, factuur-detectie volgt bij INVOIC-builder.
  const result = detectBerichttype(raw);
  // Niet 'order' — hetzij 'unknown' hetzij iets anders. Belangrijk dat het niet
  // verkeerd als order wordt geinterpreteerd.
  assert(result !== 'order', `Factuur mag niet als order worden gedetecteerd (kreeg '${result}')`);
});

Deno.test('isTestMessage — markeert testberichten op vlaggen-veld', () => {
  // Synthetisch: Y in vlaggen-string
  const fakeHeader = {
    ordernummer: 'TEST123',
    leverdatum: null,
    vlaggen: 'YNNNNNNNNNN',
    afnemer_naam: null,
    gln_gefactureerd: null,
    orderdatum: null,
    gln_besteller: null,
    gln_afleveradres: null,
    gln_leverancier: '8715954999998',
    test_flag: 'N',
  };
  assertEquals(isTestMessage(fakeHeader), true);

  // Tail-flag
  const fakeHeader2 = { ...fakeHeader, vlaggen: 'NNNNNNNNNNN', test_flag: 'Y' };
  assertEquals(isTestMessage(fakeHeader2), true);

  // Niet test
  const prodHeader = { ...fakeHeader, vlaggen: 'NNNNNNNNNNN', test_flag: 'N' };
  assertEquals(isTestMessage(prodHeader), false);
});
