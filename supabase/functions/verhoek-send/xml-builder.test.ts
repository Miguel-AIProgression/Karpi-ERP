import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  bouwVerhoekBestandsnaam,
  bouwVerhoekXml,
  naarDecagram,
  valideerVerhoekColli,
  verhoekVerpakkingseenheid,
} from './xml-builder.ts';
import { DEFAULT_VERHOEK_OPTIES } from './types.ts';
import type { BouwVerhoekXmlArgs, VerhoekColliInput } from './types.ts';

function fixtureArgs(): BouwVerhoekXmlArgs {
  return {
    zending: {
      zending_nr: 'ZEND-2026-0042',
      afl_naam: 'Wonen & Co <Aalten>',
      afl_adres: 'Saturnusstraat 60 (Unit 30)',
      afl_postcode: '7891 AB',
      afl_plaats: 'Aalten',
      afl_land: 'Nederland',
      afl_telefoon: '0543123456',
      afl_email: 'klant@voorbeeld.nl',
      opmerkingen: 'Vragen naar dhr. Jansen',
      verzenddatum: '2026-06-12',
    },
    order: { order_nr: 'ORD-2026-0815' },
    bedrijf: {
      bedrijfsnaam: 'KARPI BV',
      adres: 'Tweede Broekdijk 10',
      postcode: '7122 LB',
      plaats: 'Aalten',
      land: 'NL',
      telefoon: '0543476116',
      email: 'info@karpi.nl',
    },
    opties: { ...DEFAULT_VERHOEK_OPTIES, opdrachtgever_nummer: 'OG9999' },
    colli: [
      {
        colli_nr: 1, sscc: '087159540000000014', gewicht_kg: 12.34,
        omschrijving_snapshot: 'MAATW. SISAL-GOLD 21 160x090 cm',
        artikelnr: 'SIGO21', lengte_cm: 160, breedte_cm: 90,
      },
      {
        colli_nr: 2, sscc: '087159540000000021', gewicht_kg: 25,
        omschrijving_snapshot: 'BERBER 400x300', artikelnr: 'BERB01',
        lengte_cm: 400, breedte_cm: 300,
      },
    ],
  };
}

Deno.test('naarDecagram: kg ×100, afgerond, minimaal 1', () => {
  assertEquals(naarDecagram(125), 12500);
  assertEquals(naarDecagram(12.34), 1234);
  assertEquals(naarDecagram(12.345), 1235);
  assertEquals(naarDecagram(0.001), 1);
});

Deno.test('bestandsnaam: Karpi_<timestamp>_<zending_nr>.xml', () => {
  const nu = new Date(2026, 5, 12, 13, 9, 20);
  assertEquals(bouwVerhoekBestandsnaam('ZEND-2026-0042', nu), 'Karpi_20260612130920_ZEND-2026-0042.xml');
});

Deno.test('valideerVerhoekColli: dims en gewicht verplicht', () => {
  const kapot: VerhoekColliInput[] = [
    { colli_nr: 1, sscc: '087159540000000014', gewicht_kg: null, omschrijving_snapshot: null, artikelnr: null, lengte_cm: null, breedte_cm: 90 },
  ];
  const problemen = valideerVerhoekColli(kapot);
  assertEquals(problemen.length, 2);
  assertEquals(problemen.map((p) => p.veld).sort(), ['gewicht_kg', 'lengte_cm']);
  assertEquals(valideerVerhoekColli(fixtureArgs().colli), []);
});

Deno.test('bouwVerhoekXml: structuur, escaping, kernvelden', () => {
  const xml = bouwVerhoekXml(fixtureArgs());
  assertStringIncludes(xml, '<?xml version="1.0" encoding="utf-8"?>');
  assertStringIncludes(xml, '<Versie>AA2.0</Versie>');
  assertStringIncludes(xml, '<OrderEntryID>001</OrderEntryID>');
  assertStringIncludes(xml, '<OpdrachtgeverNummer>OG9999</OpdrachtgeverNummer>');
  // Escaping: '&' en '<>' in ontvangernaam mogen de XML niet breken
  assertStringIncludes(xml, '<OntvangerNaam>Wonen &amp; Co &lt;Aalten&gt;</OntvangerNaam>');
  // Adres-splitsing: huisnummer apart, haakjes-toevoeging eraan vast
  assertStringIncludes(xml, '<OntvangerStraat>Saturnusstraat</OntvangerStraat>');
  assertStringIncludes(xml, '<OntvangerHuisnummer>60 Unit 30</OntvangerHuisnummer>');
  assertStringIncludes(xml, '<OntvangerLandCode>NL</OntvangerLandCode>');
  assertStringIncludes(xml, '<Referentie>ZEND-2026-0042</Referentie>');
  assertStringIncludes(xml, '<InfoVrachtbrief>Vragen naar dhr. Jansen</InfoVrachtbrief>');
  // T&T: e-mail aanwezig → TrackTraceID = zending_nr
  assertStringIncludes(xml, '<TrackTraceID>ZEND-2026-0042</TrackTraceID>');
  // Parts: 2 colli, ScanCode = 00+sscc, gewicht in decagram, dims in cm
  assertStringIncludes(xml, '<OrderEntryPartID>001</OrderEntryPartID>');
  assertStringIncludes(xml, '<OrderEntryPartID>002</OrderEntryPartID>');
  assertStringIncludes(xml, '<ScanCode>00087159540000000014</ScanCode>');
  // RolNummer = de barcode (Verhoek-mail 24-06), dus gelijk aan ScanCode, niet het volgnummer.
  assertStringIncludes(xml, '<RolNummer>00087159540000000014</RolNummer>');
  assertStringIncludes(xml, '<Gewicht>1234</Gewicht>');
  assertStringIncludes(xml, '<Lengte>160</Lengte>');
  assertStringIncludes(xml, '<Breedte>90</Breedte>');
  assertStringIncludes(xml, '<ArtikelID>SIGO21</ArtikelID>');
  // Verpakkingseenheid afgeleid per colli (mail Verhoek 16-06): colli 1 (160×90)
  // = Karpet, colli 2 (400×300) = Coupon. Nooit 'Rol'.
  assertStringIncludes(xml, '<Verpakkingseenheid>Karpet</Verpakkingseenheid>');
  assertStringIncludes(xml, '<Verpakkingseenheid>Coupon</Verpakkingseenheid>');
  // Afzender = Karpi; AfwijkendeAfzender leeg (alleen vullen bij afwijking).
  assertStringIncludes(xml, '<AfzenderNaam>KARPI BV</AfzenderNaam>');
  assertStringIncludes(xml, '<AfwijkendeAfzenderNaam/>');
  assertStringIncludes(xml, '<AfwijkendeAfzenderStraat/>');
});

Deno.test('verhoekVerpakkingseenheid: classificeert binnen Verhoeks maat-envelopes, nooit Rol', () => {
  assertEquals(verhoekVerpakkingseenheid(160, 90), 'Karpet'); // kleine rug
  assertEquals(verhoekVerpakkingseenheid(300, 200), 'Karpet'); // standaard rug, 6 m²
  assertEquals(verhoekVerpakkingseenheid(400, 300), 'Coupon'); // te breed voor Karpet
  assertEquals(verhoekVerpakkingseenheid(600, 100), 'Loper'); // smal & lang
  assertEquals(verhoekVerpakkingseenheid(2000, 120), 'Loper'); // lange loper
  assertEquals(verhoekVerpakkingseenheid(500, 500), 'Coupon'); // 25 m²
  // Afmeting onbekend → null (caller valt terug op config-default).
  assertEquals(verhoekVerpakkingseenheid(null, 90), null);
  assertEquals(verhoekVerpakkingseenheid(160, 0), null);
});

Deno.test('bouwVerhoekXml: Levering/SoortLevering uit config; ScanCode blijft de labelbarcode', () => {
  const args = fixtureArgs();
  args.opties = { ...args.opties, levering: '2', soort_levering: '3' };
  const xml = bouwVerhoekXml(args);
  // ScanCode is altijd AI(00)+SSCC (gedeelde labelbarcode-seam) — geen
  // per-carrier prefix-vlag meer, dus geen kale-SSCC-variant.
  assertStringIncludes(xml, '<ScanCode>00087159540000000014</ScanCode>');
  assertStringIncludes(xml, '<Levering>2</Levering>');
  assertStringIncludes(xml, '<SoortLevering>3</SoortLevering>');
});

Deno.test('bouwVerhoekXml: fallback op config-Verpakkingseenheid als afmeting onbekend', () => {
  const args = fixtureArgs();
  args.colli = [{
    colli_nr: 1, sscc: '087159540000000014', gewicht_kg: 12, omschrijving_snapshot: null,
    artikelnr: 'X', lengte_cm: null, breedte_cm: null,
  }];
  args.opties = { ...args.opties, verpakkingseenheid: 'Coupon' };
  const xml = bouwVerhoekXml(args);
  assertStringIncludes(xml, '<Verpakkingseenheid>Coupon</Verpakkingseenheid>');
});

Deno.test('bouwVerhoekXml: zonder afl_email géén TrackTraceID; leeg opdrachtgevernummer = lege tag', () => {
  const args = fixtureArgs();
  args.zending.afl_email = null;
  args.opties = { ...args.opties, opdrachtgever_nummer: '' };
  const xml = bouwVerhoekXml(args);
  assertStringIncludes(xml, '<TrackTraceID/>');
  assert(!xml.includes('<TrackTraceID>'));
  assertStringIncludes(xml, '<OpdrachtgeverNummer/>');
});
