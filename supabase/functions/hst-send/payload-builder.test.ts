// Deno-test voor de pure payload-builder.
//
// Verifieert de werkelijke HST-shape (PascalCase, To/FromAddress,
// TransportOrderLines) zoals bevestigd in de live ACCP-rondreis van
// 2026-05-27 (zie fixtures/README.md). De fixture in
// `example-transportorder-request.json` is HST's eigen voorbeeldbestand
// — het is een referentie voor de shape, niet de exacte output van onze builder
// voor een specifieke Karpi-zending.
//
// Run:
//   cd supabase/functions/hst-send
//   deno test --allow-read payload-builder.test.ts

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { bouwTransportOrderPayload, splitAdres } from './payload-builder.ts';

const KARPI_BEDRIJF = {
  bedrijfsnaam: 'Karpi B.V.',
  adres: 'Tweede Broekdijk 10',
  postcode: '7122 LB',
  plaats: 'Aalten',
  land: 'NL',
  telefoon: '+31 (0)543-476116',
  email: 'info@karpi.nl',
};

Deno.test('bouwTransportOrderPayload — per-colli regels met SSCC-BarCode', () => {
  const result = bouwTransportOrderPayload({
    zending: {
      zending_nr: 'ZEND-2026-0001',
      afl_naam: 'Klaarenbeek interieurs',
      afl_adres: 'Koningin Wilhelminaweg 257',
      afl_postcode: '1111AA',
      afl_plaats: 'Diemen',
      afl_land: 'NL',
      afl_telefoon: '0612345678',
      totaal_gewicht_kg: 126,
      aantal_colli: 2,
      opmerkingen: 'Transport instructie',
      verzenddatum: '2026-05-27',
    },
    order: { order_nr: 'ORD-2026-0042' },
    bedrijf: KARPI_BEDRIJF,
    hstCustomerId: '038267',
    colli: [
      {
        colli_nr: 1,
        sscc: '087159540000000018',
        gewicht_kg: 25,
        omschrijving_snapshot: 'MAATW. SISAL-GOLD 160x230 cm',
      },
      {
        colli_nr: 2,
        sscc: '087159540000000026',
        gewicht_kg: 30,
        omschrijving_snapshot: 'MAATW. SISAL-GOLD 200x300 cm',
      },
    ],
  });

  // Top-level
  assertEquals(result.CustomerID, '038267');
  assertEquals(result.CustomerReference, 'ZEND-2026-0001');
  assertEquals(result.HasBarcode, true);
  assertEquals(result.OrderType, 'DELIVERY_LARGE');
  assertEquals(result.TransportInstruction, 'Transport instructie');

  // FromAddress = Karpi (gesplitste straat/nummer + postcode zonder spatie)
  assertEquals(result.FromAddress.Street, 'Tweede Broekdijk');
  assertEquals(result.FromAddress.StreetNumber, '10');
  assertEquals(result.FromAddress.ZipCode, '7122LB');

  // ToAddress = afleveradres uit zending
  assertEquals(result.ToAddress.Street, 'Koningin Wilhelminaweg');
  assertEquals(result.ToAddress.StreetNumber, '257');
  assertEquals(result.ToAddress.ZipCode, '1111AA');

  // Twee transportregels, één per colli, elk met eigen SSCC-BarCode
  assertEquals(result.TransportOrderLines.length, 2);

  const line1 = result.TransportOrderLines[0];
  assertEquals(line1.Quantity, 1);
  assertEquals(line1.Weight, 25);
  assertEquals(line1.GoodsDescription, 'MAATW. SISAL-GOLD 160x230 cm');
  assertEquals(line1.BarCode, { BarCode: '00087159540000000018' }); // AI(00) + SSCC

  const line2 = result.TransportOrderLines[1];
  assertEquals(line2.Weight, 30);
  assertEquals(line2.BarCode, { BarCode: '00087159540000000026' });
  assertEquals(line2.GoodsDescription, 'MAATW. SISAL-GOLD 200x300 cm');
});

Deno.test('bouwTransportOrderPayload — fallback naar aggregate-regel zonder colli', () => {
  // Defensieve fallback: als de orchestrator-guard mist en er gaat toch een
  // zending zonder colli's door, krijgen we minstens nog een geldige call.
  const result = bouwTransportOrderPayload({
    zending: {
      zending_nr: 'ZEND-2026-0002',
      afl_naam: 'Klaarenbeek interieurs',
      afl_adres: 'Koningin Wilhelminaweg 257',
      afl_postcode: '1111AA',
      afl_plaats: 'Diemen',
      afl_land: 'NL',
      afl_telefoon: null,
      totaal_gewicht_kg: 50,
      aantal_colli: 2,
      opmerkingen: null,
      verzenddatum: null,
    },
    order: { order_nr: 'ORD-2026-0050' },
    bedrijf: KARPI_BEDRIJF,
    hstCustomerId: '038267',
    colli: [],
  });

  assertEquals(result.HasBarcode, false);
  assertEquals(result.TransportOrderLines.length, 1);
  assertEquals(result.TransportOrderLines[0].Quantity, 2);
  assertEquals(result.TransportOrderLines[0].Weight, 50);
  assertEquals(result.TransportOrderLines[0].BarCode, { BarCode: '' });
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
      afl_telefoon: null,
      totaal_gewicht_kg: null,
      aantal_colli: null,
      opmerkingen: 'Spoed',
      verzenddatum: null,
    },
    order: { order_nr: 'ORD-2026-0099' },
    bedrijf: { ...KARPI_BEDRIJF, land: 'Nederland' },
    hstCustomerId: '038267',
    colli: [
      {
        colli_nr: 1,
        sscc: '087159540000000034',
        gewicht_kg: null,
        omschrijving_snapshot: null,
      },
    ],
  });

  assertEquals(result.ToAddress.Name, '');
  assertEquals(result.ToAddress.Country, '');
  assertEquals(result.FromAddress.Country, 'NL'); // 'Nederland' → 'NL'
  assertEquals(result.TransportOrderLines[0].Quantity, 1);
  assertEquals(result.TransportOrderLines[0].Weight, 1); // default als gewicht ontbreekt
  assertEquals(result.TransportOrderLines[0].BarCode, { BarCode: '00087159540000000034' });
  assertEquals(result.TransportInstruction, 'Spoed');
});

Deno.test('bouwTransportOrderPayload zet ToAddress.PhoneNumber uit afl_telefoon', () => {
  const payload = bouwTransportOrderPayload({
    zending: {
      zending_nr: 'ZEND-2026-9999', afl_naam: 'Klant', afl_adres: 'Teststraat 1',
      afl_postcode: '1111AA', afl_plaats: 'Diemen', afl_land: 'NL',
      afl_telefoon: '0612345678', totaal_gewicht_kg: 5, aantal_colli: 1,
      opmerkingen: null, verzenddatum: '2026-06-09',
    },
    order: { order_nr: 'ORD-2026-9999' },
    bedrijf: {
      bedrijfsnaam: 'Karpi B.V.', adres: 'Tweede Broekdijk 10', postcode: '7122LB',
      plaats: 'Aalten', land: 'NL', telefoon: '0543476116', email: 'info@karpi.nl',
    },
    hstCustomerId: '038267',
    colli: [{ colli_nr: 1, sscc: '087159540000000632', gewicht_kg: 5, omschrijving_snapshot: 'Tapijt' }],
  });
  assertEquals(payload.ToAddress.PhoneNumber, '0612345678');
});

Deno.test('splitAdres — straat + nummer + toevoeging', () => {
  assertEquals(splitAdres('Tweede Broekdijk 10'),
    { street: 'Tweede Broekdijk', number: '10', addition: '' });

  assertEquals(splitAdres('Koningin Wilhelminaweg 257'),
    { street: 'Koningin Wilhelminaweg', number: '257', addition: '' });

  assertEquals(splitAdres('Hoofdstraat 12 A'),
    { street: 'Hoofdstraat', number: '12', addition: 'A' });

  assertEquals(splitAdres('Industrieweg 7B'),
    { street: 'Industrieweg', number: '7', addition: 'B' });

  // Fallback: alleen straat zonder nummer
  assertEquals(splitAdres('Postbus 123'),
    { street: 'Postbus', number: '123', addition: '' });

  assertEquals(splitAdres(''),
    { street: '', number: '', addition: '' });
});
