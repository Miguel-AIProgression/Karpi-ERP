// Deno-test voor de pure payload-builder.
//
// Vergelijkt de output van bouwTransportOrderPayload tegen de fixture in
// fixtures/example-transportorder-request.json. Zolang de fixture nog een
// placeholder is (Fase 0 nog niet voltooid), test deze de huidige interne
// shape van de builder. Na Fase 0 wordt de fixture vervangen door de echte
// HST-shape — dan moet builder + types.ts mee-evolueren tot deze test groen
// blijft.
//
// Run:
//   cd supabase/functions/hst-send
//   deno test --allow-read payload-builder.test.ts

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { bouwTransportOrderPayload } from './payload-builder.ts';
import expectedFixture from './fixtures/example-transportorder-request.json' with {
  type: 'json',
};

Deno.test('bouwTransportOrderPayload — happy path matcht placeholder-fixture', () => {
  const result = bouwTransportOrderPayload({
    zending: {
      zending_nr: 'ZEND-2026-0001',
      afl_naam: 'KNUTZEN TEPPICH-HOF',
      afl_adres: 'OSTERWEIDE 14',
      afl_postcode: '23562',
      afl_plaats: 'LUEBECK',
      afl_land: 'DE',
      totaal_gewicht_kg: 12.5,
      aantal_colli: 1,
      opmerkingen: null,
      verzenddatum: '2026-05-04',
    },
    order: {
      order_nr: 'ORD-2026-0042',
    },
    bedrijf: {
      bedrijfsnaam: 'KARPI BV',
      adres: 'Tweede Broekdijk 10',
      postcode: '7122 LB',
      plaats: 'Aalten',
      land: 'NL',
      telefoon: '+31 (0)543-476116',
      email: 'info@karpi.nl',
    },
    hstCustomerId: '038267',
  });

  // Volledige deep-equal tegen de fixture. Werkt zolang fixture en builder
  // dezelfde shape hebben — na Fase 0 één van beide aanpassen tot weer groen.
  assertEquals(result, expectedFixture);
});

Deno.test('bouwTransportOrderPayload — vult lege strings bij ontbrekend afleveradres', () => {
  const result = bouwTransportOrderPayload({
    zending: {
      zending_nr: 'ZEND-2026-0099',
      afl_naam: null,
      afl_adres: null,
      afl_postcode: null,
      afl_plaats: null,
      afl_land: null,
      totaal_gewicht_kg: null,
      aantal_colli: null,
      opmerkingen: 'Spoed',
      verzenddatum: null,
    },
    order: { order_nr: 'ORD-2026-0099' },
    bedrijf: {
      bedrijfsnaam: 'KARPI BV',
      adres: 'Tweede Broekdijk 10',
      postcode: '7122 LB',
      plaats: 'Aalten',
      land: 'Nederland',
      telefoon: '+31 (0)543-476116',
      email: 'info@karpi.nl',
    },
    hstCustomerId: '038267',
  });

  assertEquals(result.consignee.name, '');
  assertEquals(result.consignee.country, '');
  assertEquals(result.shipper.country, 'NL'); // 'Nederland' → 'NL'
  assertEquals(result.packages[0].quantity, 1);
  assertEquals(result.packages[0].weightKg, null);
  assertEquals(result.remarks, 'Spoed');
  assertEquals(result.pickupDate, null);
});
