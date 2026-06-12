// Pure XML-builder: ruwe Supabase-data → GS1 TransportInstruction-XML
// (standaard "RHE", TypeVersion 3.1) voor Rhenus. Géén DB-toegang, géén
// secrets — triviaal unit-testbaar.
//
// Bron-shape: legacy RHE260521001.xml (excerpt + toelichting in
// docs/rhenus/voorbeelden/). Bewuste keuzes, legacy-conform:
// - 1 zending = 1 bestand met één <transportInstruction>;
//   entityIdentification = zending_nr (uniek, CS-zoeksleutel).
// - <sscc> = AI(00)+SSCC (20 cijfers, exact het label) — config-vlag.
// - Weight/totalGrossWeight in kg mét decimalen (géén decagram — Verhoek).
// - dimension/depth = lengte in hele cm; rollen krijgen géén width (legacy).
// - plannedDelivery/plannedCollection dragen 'YYYY-MM-DDT' (trailing T).
// - Lege waarden als leeg tag-paar (<TelNumber></TelNumber>), zoals legacy.
// - ≥1 colli is verplicht: Rhenus' mapping eist een item-segment
//   (incident 0455395, mail 12-06-2026) — de builder gooit als laatste poort.
//
// Plan: docs/superpowers/plans/2026-06-12-rhenus-transporteur-gs1-xml-sftp.md

import { normalizeCountry } from '../_shared/adres-split.ts';
import type {
  BouwRhenusXmlArgs,
  ColliProbleem,
  RhenusColliInput,
  RhenusOpties,
} from './types.ts';

// Zelfde GLN als het Transus-EDI-kanaal (CLAUDE.md: Karpi-GLN).
export const KARPI_GLN = '8715954999998';

// kg → string met max 2 decimalen, trailing nullen gestript ('19.8', '5',
// '0.68') — zoals het legacy-bestand. De 1e-9-correctie vangt float-ruis
// (12.345*100 = 1234.4999...) vóór het afronden.
export function formatKg(kg: number): string {
  return String(Math.round(kg * 100 + 1e-9) / 100);
}

export function bouwRhenusBestandsnaam(prefix: string, zendingNr: string, nu: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ts = `${nu.getFullYear()}${p(nu.getMonth() + 1)}${p(nu.getDate())}` +
    `${p(nu.getHours())}${p(nu.getMinutes())}${p(nu.getSeconds())}`;
  return `${prefix}_${ts}_${zendingNr}.xml`;
}

// Rhenus-verplichte velden. Ontbreekt iets → de orchestrator zet de rij op
// Fout mét deze meldingen, zónder upload (kansloze-poging-principe ADR-0030).
export function valideerRhenusColli(colli: RhenusColliInput[]): ColliProbleem[] {
  if (colli.length === 0) {
    return [{
      colli_nr: 0,
      veld: 'aantal',
      melding: 'Zending zonder colli — Rhenus verplicht >=1 transportInstructionShipmentItem ' +
        '(bericht valt anders bij hen in error, incident 0455395). ' +
        'Pickronde moet genereer_zending_colli aanroepen.',
    }];
  }
  const problemen: ColliProbleem[] = [];
  for (const c of colli) {
    if (!c.sscc || c.sscc.trim() === '') {
      problemen.push({ colli_nr: c.colli_nr, veld: 'sscc', melding: `Colli ${c.colli_nr}: SSCC ontbreekt (sscc-tag is verplicht).` });
    }
    if (!c.gewicht_kg || c.gewicht_kg <= 0) {
      problemen.push({ colli_nr: c.colli_nr, veld: 'gewicht_kg', melding: `Colli ${c.colli_nr}: gewicht (kg) ontbreekt — verplicht voor Rhenus-planning.` });
    }
    if (!c.lengte_cm || c.lengte_cm <= 0) {
      problemen.push({ colli_nr: c.colli_nr, veld: 'lengte_cm', melding: `Colli ${c.colli_nr}: lengte (cm) ontbreekt — verplicht voor Rhenus-planning (dimension/depth).` });
    }
  }
  return problemen;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Lege waarde → leeg tag-paar (<Tag></Tag>), conform het legacy-bestand
// (géén zelfsluitende tags in de instruction-body).
function tag(naam: string, waarde: string | number | null | undefined, attrs = ''): string {
  const open = attrs ? `<${naam} ${attrs}>` : `<${naam}>`;
  if (waarde === null || waarde === undefined || waarde === '') return `${open}</${naam}>`;
  return `${open}${esc(String(waarde))}</${naam}>`;
}

interface AdresBlok {
  city: string;
  countryCode: string;
  name: string;
  postalCode: string;
  streetAddressOne: string;
}

// GS1-XSD-volgorde (alfabetisch), zoals legacy.
function adresTags(a: AdresBlok): string[] {
  return [
    '<address>',
    tag('city', a.city),
    tag('countryCode', a.countryCode),
    tag('name', a.name),
    tag('postalCode', a.postalCode),
    tag('streetAddressOne', a.streetAddressOne),
    '</address>',
  ];
}

// ISO 'YYYY-MM-DD' uit lokale datumdelen (geen toISOString — UTC-shift rond
// middernacht zou de fallback-datum een dag kunnen verschuiven).
function localDatum(nu: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${nu.getFullYear()}-${p(nu.getMonth() + 1)}-${p(nu.getDate())}`;
}

function bouwItem(c: RhenusColliInput, volgnr: number, opties: RhenusOpties): string[] {
  return [
    '<transportInstructionShipmentItem>',
    tag('lineItemNumber', volgnr),
    '<logisticUnit>',
    tag('sscc', opties.sscc_met_00_prefix ? `00${c.sscc}` : c.sscc),
    tag('Weight', c.gewicht_kg !== null ? formatKg(c.gewicht_kg) : ''),
    tag('packageTypeCode', opties.package_type_code),
    '<dimension>',
    tag('depth', c.lengte_cm !== null ? Math.round(c.lengte_cm) : '', 'measurementUnitCode="CMS"'),
    '</dimension>',
    '</logisticUnit>',
    '</transportInstructionShipmentItem>',
  ];
}

export function bouwRhenusXml(args: BouwRhenusXmlArgs): string {
  const { zending, order, bedrijf, opties, colli, nu } = args;

  // Laatste poort (defense-in-depth naast valideerRhenusColli + orchestrator):
  // een bericht zonder item-segment valt bij Rhenus in error (incident 0455395).
  if (colli.length === 0) {
    throw new Error(
      `Zending ${zending.zending_nr} heeft 0 colli — Rhenus verplicht >=1 item-segment (incident 0455395).`,
    );
  }

  const tijdstip = nu.toISOString().replace(/(\.\d{3})\d*Z$/, '$1Z'); // ms-precisie + Z
  const plannedDatum = `${zending.verzenddatum ?? localDatum(nu)}T`;

  const ontvanger: AdresBlok = {
    city: zending.afl_plaats ?? '',
    countryCode: normalizeCountry(zending.afl_land ?? ''),
    name: zending.afl_naam ?? '',
    postalCode: zending.afl_postcode ?? '',
    streetAddressOne: zending.afl_adres ?? '',
  };
  const afzender: AdresBlok = {
    city: bedrijf.plaats,
    countryCode: normalizeCountry(bedrijf.land),
    name: bedrijf.bedrijfsnaam,
    postalCode: bedrijf.postcode,
    streetAddressOne: bedrijf.adres,
  };

  const totaalGewicht = formatKg(colli.reduce((som, c) => som + (c.gewicht_kg ?? 0), 0));
  const freetext = `Order ${order.order_nr}` +
    ((order.klant_referentie ?? '').trim() !== '' ? ` Ref ${order.klant_referentie}` : '');

  const regels: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<transport_instruction:transportInstructionMessage xmlns:transport_instruction="urn:gs1:ecom:transport_instruction:xsd:3" xmlns:sh="http://www.unece.org/cefact/namespaces/StandardBusinessDocumentHeader" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:gs1:ecom:transport_instruction:xsd:3 ../Schemas/gs1/ecom/TransportInstruction.xsd">',
    '<sh:StandardBusinessDocumentHeader>',
    '<sh:HeaderVersion></sh:HeaderVersion>',
    '<sh:Sender>',
    '<sh:Identifier Authority="KARPI"/>',
    '</sh:Sender>',
    '<sh:Receiver>',
    '<sh:Identifier Authority="RHENUS"/>',
    '</sh:Receiver>',
    '<sh:DocumentIdentification>',
    '<sh:Standard>RHE</sh:Standard>',
    '<sh:TypeVersion>3.1</sh:TypeVersion>',
    `<sh:InstanceIdentifier>${KARPI_GLN}</sh:InstanceIdentifier>`,
    '<sh:Type>Transport Instruction Message</sh:Type>',
    `<sh:CreationDateAndTime>${tijdstip}</sh:CreationDateAndTime>`,
    '</sh:DocumentIdentification>',
    '</sh:StandardBusinessDocumentHeader>',
    '<transportInstruction>',
    tag('creationDateTime', tijdstip),
    tag('documentStatusCode', 'ORIGINAL'),
    '<transportInstructionIdentification>',
    tag('entityIdentification', zending.zending_nr),
    '</transportInstructionIdentification>',
    tag('transportInstructionFunction', 'SHIPMENT'),
    '<transportInstructionShipment>',
    '<receiver>',
    ...adresTags(ontvanger),
    '<contact>',
    tag('TelNumber', zending.afl_telefoon ?? ''),
    '</contact>',
    '</receiver>',
    '<shipper>',
    ...adresTags(afzender),
    '</shipper>',
    '<carrier>',
    tag('additionalPartyIdentification', 'Rhenus', 'additionalPartyIdentificationTypeCode="requested carrier"'),
    '</carrier>',
    '<transportCargoCharacteristics>',
    tag('cargoTypeDescription', '', 'languageCode="EN"'),
    tag('totalGrossWeight', totaalGewicht, 'measurementUnitCode="KGM"'),
    tag('totalPackageQuantity', colli.length),
    '</transportCargoCharacteristics>',
    '<plannedDelivery>',
    '<logisticEventDateTime>',
    tag('date', plannedDatum),
    '</logisticEventDateTime>',
    '</plannedDelivery>',
    '<plannedCollection>',
    '<logisticEventDateTime>',
    tag('date', plannedDatum),
    '</logisticEventDateTime>',
    '</plannedCollection>',
    '<packageTotal>',
    tag('totalPackageQuantity', colli.length),
    '</packageTotal>',
    '<transportReference>',
    tag('entityIdentification', zending.zending_nr),
    tag('creationDateTime', tijdstip),
    tag('Freetext', freetext),
    '</transportReference>',
    ...colli.flatMap((c, i) => bouwItem(c, i + 1, opties)),
    '</transportInstructionShipment>',
    '</transportInstruction>',
    '</transport_instruction:transportInstructionMessage>',
    '',
  ];

  return regels.join('\n');
}
