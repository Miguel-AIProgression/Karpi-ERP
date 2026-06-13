import { assert, assertEquals, assertStringIncludes, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  bouwRhenusBestandsnaam,
  bouwRhenusXml,
  formatKg,
  valideerRhenusColli,
} from './xml-builder.ts';
import { DEFAULT_RHENUS_OPTIES } from './types.ts';
import type { BouwRhenusXmlArgs, RhenusColliInput } from './types.ts';

const NU = new Date(2026, 5, 12, 13, 9, 20); // 12-06-2026 13:09:20 lokaal

function fixtureArgs(): BouwRhenusXmlArgs {
  return {
    zending: {
      zending_nr: 'ZEND-2026-0042',
      afl_naam: 'Wonen & Co <Aalten>',
      afl_adres: 'Saturnusstraat 60',
      afl_postcode: '7891 AB',
      afl_plaats: 'Aalten',
      afl_land: 'Duitsland',
      afl_telefoon: '0049-23029850',
      verzenddatum: '2026-06-15',
    },
    order: { order_nr: 'ORD-2026-0815', klant_referentie: 'EDI-order 8MZL4' },
    bedrijf: {
      bedrijfsnaam: 'KARPI BV',
      adres: 'Tweede Broekdijk 10',
      postcode: '7122 LB',
      plaats: 'Aalten',
      land: 'NL',
      telefoon: '0543476116',
      email: 'info@karpi.nl',
    },
    opties: { ...DEFAULT_RHENUS_OPTIES },
    colli: [
      { colli_nr: 1, sscc: '087159544540630024', gewicht_kg: 4.46, lengte_cm: 155, breedte_cm: null },
      { colli_nr: 2, sscc: '087159544540630013', gewicht_kg: 9.94, lengte_cm: 160, breedte_cm: null },
    ],
    nu: NU,
  };
}

Deno.test('formatKg: kg met decimalen, trailing nullen gestript (legacy-conform)', () => {
  assertEquals(formatKg(0.68), '0.68');
  assertEquals(formatKg(19.8), '19.8');
  assertEquals(formatKg(145.44), '145.44');
  assertEquals(formatKg(5), '5');
  assertEquals(formatKg(12.345), '12.35'); // afronden op 2 decimalen
});

Deno.test('bestandsnaam: <prefix>_<timestamp>_<zending_nr>.xml', () => {
  assertEquals(
    bouwRhenusBestandsnaam('RHE', 'ZEND-2026-0042', NU),
    'RHE_20260612130920_ZEND-2026-0042.xml',
  );
});

Deno.test('valideerRhenusColli: 0 colli is een harde fout (Rhenus-incident 0455395)', () => {
  const problemen = valideerRhenusColli([]);
  assertEquals(problemen.length, 1);
  assertEquals(problemen[0].veld, 'aantal');
  assertStringIncludes(problemen[0].melding, '0455395');
});

Deno.test('valideerRhenusColli: sscc, gewicht en lengte verplicht per colli', () => {
  const kapot: RhenusColliInput[] = [
    { colli_nr: 1, sscc: '', gewicht_kg: null, lengte_cm: null, breedte_cm: null },
  ];
  const problemen = valideerRhenusColli(kapot);
  assertEquals(problemen.map((p) => p.veld).sort(), ['gewicht_kg', 'lengte_cm', 'sscc']);
  assertEquals(valideerRhenusColli(fixtureArgs().colli), []);
});

Deno.test('bouwRhenusXml: SBDH-header + kernvelden (legacy-conform)', () => {
  const xml = bouwRhenusXml(fixtureArgs());
  assertStringIncludes(xml, '<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  assertStringIncludes(xml, 'urn:gs1:ecom:transport_instruction:xsd:3');
  assertStringIncludes(xml, '<sh:Identifier Authority="KARPI"/>');
  assertStringIncludes(xml, '<sh:Identifier Authority="RHENUS"/>');
  assertStringIncludes(xml, '<sh:Standard>RHE</sh:Standard>');
  assertStringIncludes(xml, '<sh:TypeVersion>3.1</sh:TypeVersion>');
  assertStringIncludes(xml, '<sh:InstanceIdentifier>8715954999998</sh:InstanceIdentifier>');
  assertStringIncludes(xml, '<sh:Type>Transport Instruction Message</sh:Type>');
  assertStringIncludes(xml, '<documentStatusCode>ORIGINAL</documentStatusCode>');
  assertStringIncludes(xml, '<entityIdentification>ZEND-2026-0042</entityIdentification>');
  assertStringIncludes(xml, '<transportInstructionFunction>SHIPMENT</transportInstructionFunction>');
});

Deno.test('bouwRhenusXml: GLN uit bedrijfsgegevens.gln_eigen overschrijft de fallback', () => {
  const args = fixtureArgs();
  args.bedrijf = { ...args.bedrijf, gln_eigen: '8715954000001' };
  const xml = bouwRhenusXml(args);
  assertStringIncludes(xml, '<sh:InstanceIdentifier>8715954000001</sh:InstanceIdentifier>');
});

Deno.test('bouwRhenusXml: receiver/shipper/carrier + escaping + landnormalisatie', () => {
  const xml = bouwRhenusXml(fixtureArgs());
  // Escaping: '&' en '<>' in ontvangernaam mogen de XML niet breken
  assertStringIncludes(xml, '<name>Wonen &amp; Co &lt;Aalten&gt;</name>');
  assertStringIncludes(xml, '<streetAddressOne>Saturnusstraat 60</streetAddressOne>');
  assertStringIncludes(xml, '<countryCode>DE</countryCode>'); // 'Duitsland' → DE
  assertStringIncludes(xml, '<TelNumber>0049-23029850</TelNumber>');
  // Shipper uit bedrijfsgegevens
  assertStringIncludes(xml, '<name>KARPI BV</name>');
  assertStringIncludes(xml, '<streetAddressOne>Tweede Broekdijk 10</streetAddressOne>');
  assertStringIncludes(xml, 'additionalPartyIdentificationTypeCode="requested carrier">Rhenus<');
});

Deno.test('bouwRhenusXml: cargo-totalen, planned dates en Freetext', () => {
  const xml = bouwRhenusXml(fixtureArgs());
  // 4.46 + 9.94 = 14.4 kg
  assertStringIncludes(xml, '<totalGrossWeight measurementUnitCode="KGM">14.4</totalGrossWeight>');
  assertEquals(xml.match(/<totalPackageQuantity>2<\/totalPackageQuantity>/g)?.length, 2); // cargo + packageTotal
  // verzenddatum + trailing T (legacy-eigenaardigheid)
  assertStringIncludes(xml, '<date>2026-06-15T</date>');
  assertStringIncludes(xml, '<Freetext>Order ORD-2026-0815 Ref EDI-order 8MZL4</Freetext>');
});

Deno.test('bouwRhenusXml: items met 00-prefix-sscc, gewicht en depth', () => {
  const xml = bouwRhenusXml(fixtureArgs());
  assertStringIncludes(xml, '<lineItemNumber>1</lineItemNumber>');
  assertStringIncludes(xml, '<lineItemNumber>2</lineItemNumber>');
  assertStringIncludes(xml, '<sscc>00087159544540630024</sscc>');
  assertStringIncludes(xml, '<Weight>4.46</Weight>');
  assertStringIncludes(xml, '<packageTypeCode>RLEN</packageTypeCode>');
  assertStringIncludes(xml, '<depth measurementUnitCode="CMS">155</depth>');
});

Deno.test('bouwRhenusXml: opties sturen sscc-prefix en packageTypeCode', () => {
  const args = fixtureArgs();
  args.opties = { ...args.opties, sscc_met_00_prefix: false, package_type_code: 'COLL' };
  const xml = bouwRhenusXml(args);
  assertStringIncludes(xml, '<sscc>087159544540630024</sscc>');
  assertStringIncludes(xml, '<packageTypeCode>COLL</packageTypeCode>');
});

Deno.test('bouwRhenusXml: zonder klant_referentie alleen "Order <nr>"; lege telefoon = leeg paar', () => {
  const args = fixtureArgs();
  args.order.klant_referentie = null;
  args.zending.afl_telefoon = null;
  const xml = bouwRhenusXml(args);
  assertStringIncludes(xml, '<Freetext>Order ORD-2026-0815</Freetext>');
  assert(!xml.includes(' Ref '));
  assertStringIncludes(xml, '<TelNumber></TelNumber>');
});

Deno.test('bouwRhenusXml: zonder verzenddatum vallen planned dates terug op nu', () => {
  const args = fixtureArgs();
  args.zending.verzenddatum = null;
  const xml = bouwRhenusXml(args);
  assertStringIncludes(xml, '<date>2026-06-12T</date>');
});

Deno.test('bouwRhenusXml: gooit op 0 colli — een item-segment is verplicht (incident 0455395)', () => {
  const args = fixtureArgs();
  args.colli = [];
  assertThrows(() => bouwRhenusXml(args), Error, '0455395');
});
