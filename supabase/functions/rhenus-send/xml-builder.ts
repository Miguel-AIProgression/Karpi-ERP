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
import { capabilityVoor } from '../_shared/vervoerders/capabilities.ts';
import { type ColliMeldingen, type ColliProbleem, valideerColli } from '../_shared/vervoerders/colli.ts';
import { labelBarcode } from '../_shared/vervoerders/labelbarcode.ts';
import type {
  BouwRhenusXmlArgs,
  RhenusColliInput,
  RhenusOpties,
} from './types.ts';

// Fallback-GLN als app_config bedrijfsgegevens.gln_eigen ontbreekt — zelfde
// patroon als de andere outbound-kanalen (bouw-verzendbericht-edi, bouw-factuur-
// edi, factuur-verzenden). Bron-van-waarheid blijft app_config (CLAUDE.md:
// Karpi-GLN); de orchestrator geeft gln_eigen door via BedrijfInput.
export const KARPI_GLN = '8715954999998';

// kg → string met max 2 decimalen, trailing nullen gestript ('19.8', '5',
// '0.68') — zoals het legacy-bestand. De 1e-9-correctie vangt float-ruis
// (12.345*100 = 1234.4999...) vóór het afronden.
export function formatKg(kg: number): string {
  return String(Math.round(kg * 100 + 1e-9) / 100);
}

// Bestandsnaam = <prefix>_<datum>_<zending_nr>.xml (alleen datum, GÉÉN tijd).
// Rhenus-akkoord 2026-06-17 (Silvian Derksen): de oude datum+tijd-variant was te
// lang en moest ingekort naar RHE_<datum>_<zending>.xml. Uniekheid (door Rhenus
// geëist) blijft gegarandeerd: zending_nr (ZEND-2026-XXXX) is al globaal uniek
// per zending; de datum dient alleen voor sortering/overzicht. Een retry van
// dezelfde zending hergebruikt de in rhenus_transportorders.bestandsnaam
// gepersisteerde naam → géén botsing.
export function bouwRhenusBestandsnaam(prefix: string, zendingNr: string, nu: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const datum = `${nu.getFullYear()}${p(nu.getMonth() + 1)}${p(nu.getDate())}`;
  return `${prefix}_${datum}_${zendingNr}.xml`;
}

// Rhenus-verplichte velden (≥1 colli + sscc/gewicht/lengte per colli) staan in
// de capability-descriptor (ADR-0034); deze wrapper levert alleen de Rhenus-
// specifieke meldingstekst (incl. de 0-colli-melding, incident 0455395).
// Ontbreekt iets → de orchestrator zet de rij op Fout mét deze meldingen,
// zónder upload (kansloze-poging-principe ADR-0030).
const RHENUS_COLLI_MELDINGEN: ColliMeldingen = {
  geenColli: 'Zending zonder colli — Rhenus verplicht >=1 transportInstructionShipmentItem ' +
    '(bericht valt anders bij hen in error, incident 0455395). ' +
    'Pickronde moet genereer_zending_colli aanroepen.',
  perVeld: {
    sscc: (n) => `Colli ${n}: SSCC ontbreekt (sscc-tag is verplicht).`,
    gewicht_kg: (n) => `Colli ${n}: gewicht (kg) ontbreekt — verplicht voor Rhenus-planning.`,
    lengte_cm: (n) => `Colli ${n}: lengte (cm) ontbreekt — verplicht voor Rhenus-planning (dimension/depth).`,
    // Breedte is bij Rhenus niet verplicht (legacy geeft rollen geen width);
    // staat niet in colliVelden, dus deze bouwer wordt nooit aangeroepen.
    breedte_cm: (n) => `Colli ${n}: breedte (cm) ontbreekt.`,
  },
};

export function valideerRhenusColli(colli: RhenusColliInput[]): ColliProbleem[] {
  return valideerColli(colli, capabilityVoor('rhenus_sftp')!, RHENUS_COLLI_MELDINGEN);
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
  // Een pallet-bundel (mig 489) draagt pallet_type 'PLTS'/'HPLT' → die code als
  // packageTypeCode + een width-dimensie (footprint, legacy zending 9453355), plus
  // sinds mig 490 een height-dimensie (laadhoogte) als die ingevuld is. Een rol/los
  // collo heeft geen pallet_type → de geconfigureerde code (RLEN) + alleen depth,
  // exact zoals voorheen. palletCode is getypt 'PLTS'|'HPLT'|null (geen non-null-
  // assertion nodig; een EP/SP-code zou hier nooit komen — andere carrier).
  // NB <height> staat niet in het legacy-Rhenus-bestand (alleen depth+width) maar is
  // een standaard optioneel GS1-element — te bevestigen bij Rhenus' format-check.
  const palletCode = c.pallet_type === 'PLTS' || c.pallet_type === 'HPLT' ? c.pallet_type : null;
  const heeftHoogte = palletCode && c.hoogte_cm !== null && c.hoogte_cm !== undefined;
  const dimensie = [
    '<dimension>',
    tag('depth', c.lengte_cm !== null ? Math.round(c.lengte_cm) : '', 'measurementUnitCode="CMS"'),
    ...(palletCode
      ? [tag('width', c.breedte_cm !== null ? Math.round(c.breedte_cm) : '', 'measurementUnitCode="CMS"')]
      : []),
    ...(heeftHoogte
      ? [tag('height', Math.round(c.hoogte_cm as number), 'measurementUnitCode="CMS"')]
      : []),
    '</dimension>',
  ];
  return [
    '<transportInstructionShipmentItem>',
    tag('lineItemNumber', volgnr),
    '<logisticUnit>',
    // <sscc> = de labelbarcode (AI(00)+SSCC) uit de gedeelde seam — exact wat
    // op het label staat; één bron met label + HST + Verhoek.
    tag('sscc', labelBarcode(c.sscc) ?? ''),
    tag('Weight', c.gewicht_kg !== null ? formatKg(c.gewicht_kg) : ''),
    tag('packageTypeCode', palletCode ?? opties.package_type_code),
    ...dimensie,
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
    `<sh:InstanceIdentifier>${bedrijf.gln_eigen ?? KARPI_GLN}</sh:InstanceIdentifier>`,
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
