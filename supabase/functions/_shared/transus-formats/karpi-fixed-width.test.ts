// Tests voor Karpi fixed-width parser tegen productievoorbeelden.
// Deno test runner: `deno test supabase/functions/_shared/transus-formats/`

import { assertEquals, assertExists, assert } from 'https://deno.land/std@0.220.0/assert/mod.ts';
import { parseKarpiOrder, isTestMessage, detectBerichttype } from './karpi-fixed-width.ts';

const FIXTURES_DIR = new URL('../../../../docs/transus/voorbeelden/', import.meta.url);

async function loadFixture(name: string): Promise<string> {
  const url = new URL(name, FIXTURES_DIR);
  const bytes = await Deno.readFile(url);
  return new TextDecoder('windows-1252').decode(bytes);
}

Deno.test('parseKarpiOrder - Ostermann bericht 168818626 (rich, 23 regels)', async () => {
  const raw = await loadFixture('order-in-ostermann-168818626.inh');

  assertEquals(detectBerichttype(raw), 'order');

  const order = parseKarpiOrder(raw);

  assertEquals(order.header.ordernummer, '110840413000');
  assertEquals(order.header.orderdatum, '2026-04-29');
  assertEquals(order.header.afnemer_naam, 'Einrichtungsha');
  assertEquals(order.header.gln_gefactureerd, '4260217580016');
  assertEquals(order.header.gln_besteller, '4260217580146');
  assertEquals(order.header.gln_afleveradres, '4260217580146');
  assertEquals(order.header.gln_leverancier, '8715954999998');
  assertEquals(order.header.vlaggen, 'NNNNNNNNNNN');
  assertEquals(order.header.test_flag, 'N');
  assertEquals(isTestMessage(order.header), false);
  assertEquals(order.header.leverdatum, null);

  assertEquals(order.regels.length, 23);
  assertEquals(order.regels[0].regelnummer, 1000);
  assertEquals(order.regels[0].gtin, '8715954211625');
  assertEquals(order.regels[0].artikelcode, '526650044 155x230');
  assertEquals(order.regels[0].aantal, 1);
  assertEquals(order.regels[0].ordernummer_ref, '110840413000');

  const lobo = order.regels.find((r) => r.gtin === '8715954252727');
  assertExists(lobo);
  assertEquals(lobo!.aantal, 2);
  assertEquals(lobo!.regelnummer, 7000);

  assertEquals(order.regels[22].regelnummer, 23000);
  assertEquals(order.regels[22].gtin, '8715954256794');
});

Deno.test('parseKarpiOrder - BDSK bericht 168766180 (sparse, 1 regel, leverdatum)', async () => {
  const raw = await loadFixture('order-in-bdsk-168766180.inh');

  assertEquals(detectBerichttype(raw), 'order');

  const order = parseKarpiOrder(raw);

  assertEquals(order.header.ordernummer, 'WMZCGB');
  assertEquals(order.header.orderdatum, '2026-04-28');
  assertEquals(order.header.leverdatum, '2026-05-22');
  assertEquals(order.header.afnemer_naam, null);
  assertEquals(order.header.gln_gefactureerd, '9007019015989');
  assertEquals(order.header.gln_besteller, '9009852030365');
  assertEquals(order.header.gln_afleveradres, '9009852030365');
  assertEquals(order.header.gln_leverancier, '8715954999998');
  assertEquals(isTestMessage(order.header), false);

  assertEquals(order.regels.length, 1);
  assertEquals(order.regels[0].regelnummer, 1);
  assertEquals(order.regels[0].gtin, '8715954176047');
  assertEquals(order.regels[0].artikelcode, 'PATCH');
  assertEquals(order.regels[0].aantal, 1);
  assertEquals(order.regels[0].ordernummer_ref, 'WMZCGB');
});

Deno.test('parseKarpiOrder - BDSK rondreis 8MRE0 met afgekorte trailing spaces', async () => {
  const raw = await loadFixture('rondreis-bdsk-8MRE0/Karpi Group home fashion/ord168871472.inh');

  assertEquals(detectBerichttype(raw), 'order');

  const order = parseKarpiOrder(raw);
  assertEquals(order.header.ordernummer, '8MRE0');
  assertEquals(order.header.leverdatum, '2026-05-22');
  assertEquals(order.header.gln_gefactureerd, '9007019015989');
  assertEquals(order.header.gln_besteller, '9007019005430');
  assertEquals(order.header.gln_afleveradres, '9007019005430');
  assertEquals(order.regels.map((r) => r.gtin), [
    '8715954176023',
    '8715954218143',
    '8715954235829',
  ]);
});

Deno.test('parseKarpiOrder - gooit error bij te korte header', () => {
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

Deno.test('detectBerichttype - fixed-width factuur wordt nog niet herkend', async () => {
  const raw = await loadFixture('factuur-uit-bdsk-166794659.txt');
  const result = detectBerichttype(raw);
  assert(result !== 'order', `Factuur mag niet als order worden gedetecteerd (kreeg '${result}')`);
});

Deno.test('isTestMessage - markeert testberichten op vlaggen-veld', () => {
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

  const fakeHeader2 = { ...fakeHeader, vlaggen: 'NNNNNNNNNNN', test_flag: 'Y' };
  assertEquals(isTestMessage(fakeHeader2), true);

  const prodHeader = { ...fakeHeader, vlaggen: 'NNNNNNNNNNN', test_flag: 'N' };
  assertEquals(isTestMessage(prodHeader), false);
});
