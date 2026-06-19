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
import { bouwTransportOrderPayload, splitAdres, verdeelToevoeging } from './payload-builder.ts';

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
      afl_email: 'klant@voorbeeld.nl',
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
        lengte_cm: 230,
        breedte_cm: 160,
        omschrijving_snapshot: 'MAATW. SISAL-GOLD 160x230 cm',
      },
      {
        colli_nr: 2,
        sscc: '087159540000000026',
        gewicht_kg: 30,
        lengte_cm: 300,
        breedte_cm: 200,
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

  // ToAddress = afleveradres uit zending; stad in hoofdletters (oud-systeem-conventie)
  assertEquals(result.ToAddress.Street, 'Koningin Wilhelminaweg');
  assertEquals(result.ToAddress.StreetNumber, '257');
  assertEquals(result.ToAddress.ZipCode, '1111AA');
  assertEquals(result.ToAddress.City, 'DIEMEN');

  // Geen "bellen voor aflevering"-service meer (besluit 2026-06-18).
  assertEquals(result.ShippingServices, []);

  // Twee transportregels, één per colli, elk met eigen SSCC-BarCode
  assertEquals(result.TransportOrderLines.length, 2);

  const line1 = result.TransportOrderLines[0];
  assertEquals(line1.Quantity, 1);
  assertEquals(line1.Weight, 25);
  assertEquals(line1.GoodsDescription, 'MAATW. SISAL-GOLD 160x230 cm');
  assertEquals(line1.BarCode, { BarCode: '00087159540000000018' }); // AI(00) + SSCC
  // Nieuwe standaard: verzendeenheid Colli, lengte = korte zijde, breedte/hoogte = 30.
  assertEquals(line1.PackageUnitID, 'col');
  assertEquals(line1.Length, 160); // korte zijde van 230x160
  assertEquals(line1.Width, 30);
  assertEquals(line1.Height, 30);

  const line2 = result.TransportOrderLines[1];
  assertEquals(line2.Weight, 30);
  assertEquals(line2.BarCode, { BarCode: '00087159540000000026' });
  assertEquals(line2.GoodsDescription, 'MAATW. SISAL-GOLD 200x300 cm');
  assertEquals(line2.PackageUnitID, 'col');
  assertEquals(line2.Length, 200); // korte zijde van 300x200
  assertEquals(line2.Width, 30);
  assertEquals(line2.Height, 30);
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
      afl_email: null,
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
  // Aggregate-fallback: Colli, default-lengte (geen colli-maat), 30x30, geen bel.
  assertEquals(result.TransportOrderLines[0].PackageUnitID, 'col');
  assertEquals(result.TransportOrderLines[0].Length, 120);
  assertEquals(result.TransportOrderLines[0].Width, 30);
  assertEquals(result.TransportOrderLines[0].Height, 30);
  assertEquals(result.ShippingServices, []);
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
      afl_email: null,
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
      afl_telefoon: '0612345678', afl_email: null, totaal_gewicht_kg: 5, aantal_colli: 1,
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

// HST's Mendix-veld GoodsDescription weigert >30 tekens (live-fout
// ZEND-2026-0059: 'LORANDA Kleur 21 CA: 200x290 cm 290x200 cm' = 42 tekens →
// validation error). De builder kapt af op 30.
Deno.test('bouwTransportOrderPayload kapt GoodsDescription af op 30 tekens', () => {
  const payload = bouwTransportOrderPayload({
    zending: {
      zending_nr: 'ZEND-2026-0059', afl_naam: "'T STOELTJE NV", afl_adres: 'Ossenberg 42',
      afl_postcode: '2490', afl_plaats: 'Balen', afl_land: 'BE',
      afl_telefoon: '0032 14300677', afl_email: null, totaal_gewicht_kg: 21.46, aantal_colli: 1,
      opmerkingen: null, verzenddatum: '2026-06-19',
    },
    order: { order_nr: 'ORD-2026-0197' },
    bedrijf: KARPI_BEDRIJF,
    hstCustomerId: '038267',
    colli: [{
      colli_nr: 1, sscc: '087159540000000632', gewicht_kg: 21.46, lengte_cm: 290, breedte_cm: 200,
      omschrijving_snapshot: 'LORANDA Kleur 21 CA: 200x290 cm 290x200 cm',
    }],
  });
  const desc = payload.TransportOrderLines[0].GoodsDescription;
  assert(desc.length <= 30, `GoodsDescription moet ≤30 zijn, is ${desc.length}`);
  assertEquals(desc, 'LORANDA Kleur 21 CA: 200x290 c');
});

// Rol-lengte > 200 cm past niet in 'col' (live-fout ZEND-2026-0061: tapijt
// 240×330 → korte zijde 240 → 'Regel nummer 1 lengte (min: 0 | max: 200)').
// In plaats van de lengte te clampen kiest de builder een langere-pakket-code
// per maatband (mail Niek 2026-06-19): 201–274 → BDLS, 275–600 → LNGT.
Deno.test('bouwTransportOrderPayload — 201–274 cm → BDLS met echte lengte', () => {
  const payload = bouwTransportOrderPayload({
    zending: {
      zending_nr: 'ZEND-2026-0061', afl_naam: 'HOREMANS', afl_adres: 'Olenseweg 150',
      afl_postcode: '2440', afl_plaats: 'Geel', afl_land: 'BE',
      afl_telefoon: null, afl_email: null, totaal_gewicht_kg: 15.84, aantal_colli: 1,
      opmerkingen: null, verzenddatum: '2026-06-19',
    },
    order: { order_nr: 'ORD-2026-0157' },
    bedrijf: KARPI_BEDRIJF,
    hstCustomerId: '038267',
    colli: [{
      colli_nr: 1, sscc: '087159540000000632', gewicht_kg: 15.84, lengte_cm: 240, breedte_cm: 330,
      omschrijving_snapshot: 'OASI51XX240330 330x240 cm',
    }],
  });
  // korte zijde = min(240,330) = 240 → band 201–274 → BDLS, echte lengte 240.
  assertEquals(payload.TransportOrderLines[0].Length, 240);
  assertEquals(payload.TransportOrderLines[0].PackageUnitID, 'BDLS');
});

// Maatbanden rond de grenzen: 200 hoort nog bij 'col', 275 al bij LNGT.
Deno.test('bouwTransportOrderPayload — verzendeenheid per maatband', () => {
  const maak = (lengte: number, breedte: number) =>
    bouwTransportOrderPayload({
      zending: {
        zending_nr: 'ZEND-2026-0070', afl_naam: 'Klant', afl_adres: 'Teststraat 1',
        afl_postcode: '1111AA', afl_plaats: 'Diemen', afl_land: 'NL',
        afl_telefoon: null, afl_email: null, totaal_gewicht_kg: 10, aantal_colli: 1,
        opmerkingen: null, verzenddatum: '2026-06-19',
      },
      order: { order_nr: 'ORD-2026-0070' },
      bedrijf: KARPI_BEDRIJF,
      hstCustomerId: '038267',
      colli: [{ colli_nr: 1, sscc: '087159540000000632', gewicht_kg: 10, lengte_cm: lengte, breedte_cm: breedte, omschrijving_snapshot: 'Tapijt' }],
    }).TransportOrderLines[0];

  // ≤200 → col
  assertEquals(maak(200, 300).PackageUnitID, 'col');
  assertEquals(maak(200, 300).Length, 200);
  // 201–274 → BDLS
  assertEquals(maak(201, 300).PackageUnitID, 'BDLS');
  assertEquals(maak(274, 300).PackageUnitID, 'BDLS');
  // 275–600 → LNGT (max tapijtmaat = 400, ruim binnen bereik)
  assertEquals(maak(275, 400).PackageUnitID, 'LNGT');
  assertEquals(maak(400, 400).PackageUnitID, 'LNGT');
  assertEquals(maak(400, 400).Length, 400);
});

// T&T-scheiding (mail Piet-Hein/Marjon 11-06-2026): het aflever-e-mailadres
// gaat mee naar de vervoerder voor track & trace; een leeg afl_email blijft
// leeg (nooit stilletjes een factuur-adres invullen).
Deno.test('bouwTransportOrderPayload zet ToAddress.Email uit afl_email', () => {
  const basisZending = {
    zending_nr: 'ZEND-2026-9998', afl_naam: 'Klant', afl_adres: 'Teststraat 1',
    afl_postcode: '1111AA', afl_plaats: 'Diemen', afl_land: 'NL',
    afl_telefoon: '0612345678', totaal_gewicht_kg: 5, aantal_colli: 1,
    opmerkingen: null, verzenddatum: '2026-06-11',
  };
  const colli = [{ colli_nr: 1, sscc: '087159540000000632', gewicht_kg: 5, omschrijving_snapshot: 'Tapijt' }];

  const metEmail = bouwTransportOrderPayload({
    zending: { ...basisZending, afl_email: 'ontvanger@klant.nl' },
    order: { order_nr: 'ORD-2026-9998' },
    bedrijf: KARPI_BEDRIJF,
    hstCustomerId: '038267',
    colli,
  });
  assertEquals(metEmail.ToAddress.Email, 'ontvanger@klant.nl');

  const zonderEmail = bouwTransportOrderPayload({
    zending: { ...basisZending, afl_email: null },
    order: { order_nr: 'ORD-2026-9998' },
    bedrijf: KARPI_BEDRIJF,
    hstCustomerId: '038267',
    colli,
  });
  assertEquals(zonderEmail.ToAddress.Email, '');
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

// Incident ZEND-2026-0002 (11-06-2026): HST 400 "Afleveradres niet aanwezig/
// compleet" omdat StreetNumber leeg bleef bij werkelijke webshop-invoer.
// Deze cases komen letterlijk uit de orders-tabel.
Deno.test('splitAdres — werkelijke webshop-adressen (haakjes, blokhaken, reeks, komma)', () => {
  assertEquals(splitAdres('Saturnusstraat 60 (Unit 30)'),
    { street: 'Saturnusstraat', number: '60', addition: 'Unit 30' });

  assertEquals(splitAdres('Biltstraat 35 [001]'),
    { street: 'Biltstraat', number: '35', addition: '001' });

  assertEquals(splitAdres('westeresch 1-5'),
    { street: 'westeresch', number: '1', addition: '-5' });

  assertEquals(splitAdres('Koeweistraat, 6'),
    { street: 'Koeweistraat', number: '6', addition: '' });

  assertEquals(splitAdres('Raasdorperweg 181G'),
    { street: 'Raasdorperweg', number: '181', addition: 'G' });

  // Straatnaam die zelf met een nummer-woord begint blijft intact.
  assertEquals(splitAdres('2e Dorpsstraat 5'),
    { street: '2e Dorpsstraat', number: '5', addition: '' });
});

// HST-limiet: StreetNumberAddition max 5 tekens (live 400 op "Unit 30").
// Langere toevoegingen verhuizen naar NameAddition.
Deno.test('verdeelToevoeging — kort naar StreetNumberAddition, lang naar NameAddition', () => {
  assertEquals(verdeelToevoeging('G'),
    { streetNumberAddition: 'G', nameAddition: '' });
  assertEquals(verdeelToevoeging('001'),
    { streetNumberAddition: '001', nameAddition: '' });
  assertEquals(verdeelToevoeging('-5'),
    { streetNumberAddition: '-5', nameAddition: '' });
  assertEquals(verdeelToevoeging('Unit 30'),
    { streetNumberAddition: '', nameAddition: 'Unit 30' });
  assertEquals(verdeelToevoeging(''),
    { streetNumberAddition: '', nameAddition: '' });
});

Deno.test('bouwTransportOrderPayload — lange toevoeging landt in NameAddition', () => {
  const payload = bouwTransportOrderPayload({
    zending: {
      zending_nr: 'ZEND-2026-0002',
      afl_naam: 'Jeanette van Duffelen',
      afl_adres: 'Saturnusstraat 60 (Unit 30)',
      afl_postcode: '2516 AH', afl_plaats: "'s-Gravenhage", afl_land: 'NL',
      afl_telefoon: '06-57996440', afl_email: null,
      totaal_gewicht_kg: 10, aantal_colli: 1, opmerkingen: null, verzenddatum: '2026-06-11',
    },
    order: { order_nr: 'ORD-2026-0110' },
    bedrijf: KARPI_BEDRIJF,
    hstCustomerId: '038267',
    colli: [{ colli_nr: 1, sscc: '087159540000000649', gewicht_kg: 10, omschrijving_snapshot: 'Tapijt' }],
  });
  assertEquals(payload.ToAddress.Street, 'Saturnusstraat');
  assertEquals(payload.ToAddress.StreetNumber, '60');
  assertEquals(payload.ToAddress.StreetNumberAddition, '');
  assertEquals(payload.ToAddress.NameAddition, 'Unit 30');
});
