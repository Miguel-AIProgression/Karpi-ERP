// Pure XML-builder: ruwe Supabase-data → Verhoek AA2.0 XML-string.
// Géén DB-toegang, géén secrets — triviaal unit-testbaar.
//
// Bron-shape: XMLstandardVerhoekEuropeAA20.xml + eisen-mail Gerrit Altena:
// Lengte/Breedte in hele cm (verplicht), Gewicht in decagram (verplicht),
// ScanCode = exact de barcode op de eenheid, Referentie uniek (zending_nr),
// TrackTraceID historisch uniek en alleen gevuld mét OntvangerEmail.
// Tag-volgorde volgt het voorbeeldbestand exact; ongebruikte velden als lege
// tag (<Tag/>). Variabele keuzes (prefix, codes) komen uit VerhoekOpties
// (app_config 'verhoek') — antwoorden van Verhoek = config-UPDATE.
//
// Plan: docs/superpowers/plans/2026-06-11-verhoek-transporteur-xml-sftp.md

import { normalizeCountry, splitAdres } from '../_shared/adres-split.ts';
import { capabilityVoor } from '../_shared/vervoerders/capabilities.ts';
import { type ColliMeldingen, type ColliProbleem, valideerColli } from '../_shared/vervoerders/colli.ts';
import { labelBarcode } from '../_shared/vervoerders/labelbarcode.ts';
import type {
  BedrijfInput,
  BouwVerhoekXmlArgs,
  VerhoekColliInput,
  VerhoekOpties,
  ZendingInput,
} from './types.ts';

export function naarDecagram(kg: number): number {
  return Math.max(1, Math.round(kg * 100));
}

export function bouwVerhoekBestandsnaam(zendingNr: string, nu: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ts = `${nu.getFullYear()}${p(nu.getMonth() + 1)}${p(nu.getDate())}` +
    `${p(nu.getHours())}${p(nu.getMinutes())}${p(nu.getSeconds())}`;
  return `Karpi_${ts}_${zendingNr}.xml`;
}

// Verhoek-verplichte velden per colli (sscc/lengte/breedte/gewicht) staan in de
// capability-descriptor (ADR-0034); deze wrapper levert alleen de Verhoek-
// specifieke meldingstekst. Ontbreekt iets → de orchestrator zet de rij op Fout
// mét deze meldingen, zónder upload (kansloze-poging-principe ADR-0030).
const VERHOEK_COLLI_MELDINGEN: ColliMeldingen = {
  geenColli: '', // Verhoek eist geen ≥1-colli (vereistColli=false) — ongebruikt.
  perVeld: {
    sscc: (n) => `Colli ${n}: SSCC ontbreekt (ScanCode is verplicht).`,
    lengte_cm: (n) => `Colli ${n}: lengte (cm) ontbreekt — verplicht voor Verhoek-planning.`,
    breedte_cm: (n) => `Colli ${n}: breedte (cm) ontbreekt — verplicht voor Verhoek-planning.`,
    gewicht_kg: (n) => `Colli ${n}: gewicht (kg) ontbreekt — verplicht voor Verhoek-planning.`,
  },
};

export function valideerVerhoekColli(colli: VerhoekColliInput[]): ColliProbleem[] {
  return valideerColli(colli, capabilityVoor('verhoek_sftp')!, VERHOEK_COLLI_MELDINGEN);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Lege waarde → zelfsluitende tag, conform het voorbeeldbestand.
function tag(naam: string, waarde: string | number | boolean | null | undefined): string {
  if (waarde === null || waarde === undefined || waarde === '') return `<${naam}/>`;
  return `<${naam}>${esc(String(waarde))}</${naam}>`;
}

interface Partij {
  naam: string;
  straat: string;
  huisnummer: string;
  postcode: string;
  woonplaats: string;
  land: string;
  telefoon: string;
  email: string;
}

function partijTags(prefix: string, p: Partij): string[] {
  return [
    tag(`${prefix}Naam`, p.naam),
    tag(`${prefix}Straat`, p.straat),
    tag(`${prefix}Huisnummer`, p.huisnummer),
    tag(`${prefix}Postcode`, p.postcode),
    tag(`${prefix}Woonplaats`, p.woonplaats),
    tag(`${prefix}LandCode`, p.land),
    tag(`${prefix}Telefoon`, p.telefoon),
    tag(`${prefix}Fax`, ''),
    tag(`${prefix}Email`, p.email),
  ];
}

// Volledig lege partij → alle <Prefix...>-tags zelfsluitend. Verhoek wil
// ongebruikte velden als lege tag, niet weggelaten (mail 16-06-2026).
const LEGE_PARTIJ: Partij = {
  naam: '', straat: '', huisnummer: '', postcode: '', woonplaats: '', land: '', telefoon: '', email: '',
};

// Verhoek 'Verpakkingseenheid' per colli, afgeleid uit de fysieke afmetingen.
// Karpi verstuurt via Verhoek NOOIT volle rollen — alleen maatwerk + standaard-
// maten, opgerold, met een afmeting van hooguit de rolbreedte (mail Applicatie
// Management Verhoek 16-06-2026). 'Rol' (≥1251 cm lengte) komt dus bewust niet
// voor. We classificeren binnen Verhoeks eigen maat-envelopes (tabel 'Standaard
// artikelwaarden'): Karpet (de meeste rugs/standaardmaten) → Loper (smal & lang)
// → Coupon (grotere gesneden stukken; ook het vangnet). Grenzen 1-op-1 uit die
// tabel; pas hier aan als Verhoek de indeling bijstelt. null = afmeting onbekend
// → caller valt terug op de config-default (opties.verpakkingseenheid).
export function verhoekVerpakkingseenheid(
  lengte_cm: number | null | undefined,
  breedte_cm: number | null | undefined,
): string | null {
  if (!lengte_cm || !breedte_cm || lengte_cm <= 0 || breedte_cm <= 0) return null;
  const lang = Math.max(lengte_cm, breedte_cm);
  const kort = Math.min(lengte_cm, breedte_cm);
  const m2 = (lang * kort) / 10000;
  if (lang <= 500 && kort <= 240 && m2 <= 12) return 'Karpet';
  if (kort <= 130 && lang <= 2500 && m2 <= 32.5) return 'Loper';
  return 'Coupon'; // ≤1250×500 / ≤50 m²; tevens vangnet voor het uiterste geval
}

function partijUitBedrijf(b: BedrijfInput): Partij {
  const { street, number, addition } = splitAdres(b.adres);
  return {
    naam: b.bedrijfsnaam,
    straat: street,
    huisnummer: [number, addition].filter(Boolean).join(' '),
    postcode: b.postcode,
    woonplaats: b.plaats,
    land: normalizeCountry(b.land),
    telefoon: b.telefoon,
    email: b.email,
  };
}

function partijUitZending(z: ZendingInput): Partij {
  const { street, number, addition } = splitAdres(z.afl_adres ?? '');
  return {
    naam: z.afl_naam ?? '',
    straat: street,
    huisnummer: [number, addition].filter(Boolean).join(' '),
    postcode: z.afl_postcode ?? '',
    woonplaats: z.afl_plaats ?? '',
    land: normalizeCountry(z.afl_land ?? ''),
    telefoon: z.afl_telefoon ?? '',
    email: z.afl_email ?? '',
  };
}

function bouwPart(c: VerhoekColliInput, volgnr: number, opties: VerhoekOpties): string {
  const id = String(volgnr).padStart(3, '0');
  const oppervlak = c.lengte_cm && c.breedte_cm
    ? Math.max(1, Math.round((c.lengte_cm * c.breedte_cm) / 10000))
    : '';
  const regels = [
    tag('OrderEntryPartID', id),
    tag('OrderEntryID', '001'),
    tag('VerzendNummer', ''),
    tag('Aantal', 1),
    tag('ArtikelID', c.artikelnr ?? ''),
    // Afgeleid per colli uit de afmetingen (Karpet/Loper/Coupon, nooit Rol);
    // fallback op de config-default als de afmeting onbekend is.
    tag('Verpakkingseenheid', verhoekVerpakkingseenheid(c.lengte_cm, c.breedte_cm) ?? opties.verpakkingseenheid),
    tag('Omschrijving', c.omschrijving_snapshot ?? ''),
    // ScanCode MOET exact de barcode op de eenheid zijn — dus precies de
    // labelbarcode uit de gedeelde seam (AI(00)+SSCC). Eén bron met het label
    // en de andere carriers; geen per-carrier prefix-keuze meer.
    tag('ScanCode', labelBarcode(c.sscc) ?? ''),
    tag('RolNummer', c.colli_nr),
    // Decagram (eis Verhoek): 125 kg → 12500.
    tag('Gewicht', c.gewicht_kg ? naarDecagram(c.gewicht_kg) : ''),
    tag('Lengte', c.lengte_cm ?? ''),
    tag('Breedte', c.breedte_cm ?? ''),
    tag('Oppervlak', oppervlak),
    tag('NrItems', ''),
    tag('Barcode', ''),
    tag('Information', ''),
    tag('Kleur', ''),
    tag('Verfbad1', ''),
    tag('Verfbad2', ''),
    tag('Rug', ''),
    tag('Diameter', ''),
    tag('Inhoud', ''),
    tag('VolgNummer', ''),
    tag('SnijOpdracht', ''),
    tag('Emballage', 'false'),
    tag('ArtikelCode', ''),
    tag('ArtikelType', ''),
    tag('RolnummerSnijden', ''),
    tag('Valactiviteit', ''),
    tag('Hoogte', ''),
  ];
  return `\t\t<OrderEntryPart>\n${regels.map((r) => `\t\t\t${r}`).join('\n')}\n\t\t</OrderEntryPart>`;
}

export function bouwVerhoekXml(args: BouwVerhoekXmlArgs): string {
  const { zending, bedrijf, opties, colli } = args;
  const karpi = partijUitBedrijf(bedrijf);
  const ontvanger = partijUitZending(zending);
  const heeftEmail = (zending.afl_email ?? '').trim() !== '';

  const kop = [
    tag('OrderEntryID', '001'),
    tag('OpdrachtgeverNummer', opties.opdrachtgever_nummer),
    ...partijTags('Opdrachtgever', karpi),
    ...partijTags('Afzender', karpi),
    // Afwijkende afzender: alléén vullen als het afzenderadres afwijkt van Karpi
    // (mail Verhoek 16-06-2026). Bij ons is dat nooit zo → lege tags.
    ...partijTags('AfwijkendeAfzender', LEGE_PARTIJ),
    tag('OntvangerNaam', ontvanger.naam),
    tag('OntvangerNaam2', ''),
    tag('OntvangerStraat', ontvanger.straat),
    tag('OntvangerHuisnummer', ontvanger.huisnummer),
    tag('OntvangerPostcode', ontvanger.postcode),
    tag('OntvangerWoonplaats', ontvanger.woonplaats),
    tag('OntvangerLandCode', ontvanger.land),
    tag('OntvangerTelefoon', ontvanger.telefoon),
    tag('OntvangerFax', ''),
    tag('OntvangerEmail', ontvanger.email),
    // Uniek + komt op CMR + zoeksleutel Verhoek customer service.
    tag('Referentie', zending.zending_nr),
    tag('TspNummerVerkoper', ''),
    tag('EoriNummerVerkoper', ''),
    tag('TspNummerKoper', ''),
    tag('EoriNummerKoper', ''),
    tag('OrderDatum', ''),
    tag('Rembours', 'false'),
    tag('RemboursBedrag', 0),
    tag('RemboursValuta', 'EUR'),
    tag('Levering', opties.levering),
    tag('SoortLevering', opties.soort_levering),
    tag('InfoPlanner', ''),
    tag('TelefonischAdvies', ''),
    tag('KooiAap', 'false'),
    tag('Saved', 'true'),
    tag('Binnenbak', 'false'),
    tag('Laadklep', 'false'),
    tag('SelectieCode', ''),
    tag('GewensteLevering', ''),
    tag('GewensteLeverDatumVan', ''),
    tag('GewensteLeverDatumTot', ''),
    // Contactpersoon/chauffeursinfo — komt op de vrachtbrief (eis-mail).
    tag('InfoVrachtbrief', zending.opmerkingen ?? ''),
    // Historisch uniek; alleen gevuld als er een ontvanger-e-mail is —
    // Verhoek stuurt de T&T-link naar OntvangerEmail.
    tag('TrackTraceID', heeftEmail ? zending.zending_nr : ''),
    tag('Orderstatus', ''),
    tag('Promotiecode', ''),
    tag('Promotiedatum', ''),
    tag('DebiteurnummerVerhoek', ''),
    tag('Bakwagen', 'false'),
    tag('Afhaaldatum', ''),
    tag('Ordergrootte', ''),
    tag('NummerLaadeenheid', ''),
    tag('Incoterm', ''),
    tag('Levertijd', ''),
    tag('BijzondereAdressen', ''),
    tag('Mailadvies', ''),
    tag('Vervoerderskeuze', ''),
  ];

  const parts = colli.map((c, i) => bouwPart(c, i + 1, opties)).join('\n');

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<DATA>',
    '\t<Versie>AA2.0</Versie>',
    '\t<FileHash/>',
    '\t<OrderEntry>',
    kop.map((r) => `\t\t${r}`).join('\n'),
    parts,
    '\t</OrderEntry>',
    '</DATA>',
    '',
  ].join('\n');
}
