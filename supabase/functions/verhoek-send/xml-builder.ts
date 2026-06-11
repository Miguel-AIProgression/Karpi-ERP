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
import type {
  BedrijfInput,
  BouwVerhoekXmlArgs,
  ColliProbleem,
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

// Verhoek-verplichte velden per colli. Ontbreekt iets → de orchestrator zet
// de rij op Fout mét deze meldingen, zónder upload (kansloze-poging-principe
// uit ADR-0030).
export function valideerVerhoekColli(colli: VerhoekColliInput[]): ColliProbleem[] {
  const problemen: ColliProbleem[] = [];
  for (const c of colli) {
    if (!c.sscc || c.sscc.trim() === '') {
      problemen.push({ colli_nr: c.colli_nr, veld: 'sscc', melding: `Colli ${c.colli_nr}: SSCC ontbreekt (ScanCode is verplicht).` });
    }
    if (!c.lengte_cm || c.lengte_cm <= 0) {
      problemen.push({ colli_nr: c.colli_nr, veld: 'lengte_cm', melding: `Colli ${c.colli_nr}: lengte (cm) ontbreekt — verplicht voor Verhoek-planning.` });
    }
    if (!c.breedte_cm || c.breedte_cm <= 0) {
      problemen.push({ colli_nr: c.colli_nr, veld: 'breedte_cm', melding: `Colli ${c.colli_nr}: breedte (cm) ontbreekt — verplicht voor Verhoek-planning.` });
    }
    if (!c.gewicht_kg || c.gewicht_kg <= 0) {
      problemen.push({ colli_nr: c.colli_nr, veld: 'gewicht_kg', melding: `Colli ${c.colli_nr}: gewicht (kg) ontbreekt — verplicht voor Verhoek-planning.` });
    }
  }
  return problemen;
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
    tag('Verpakkingseenheid', opties.verpakkingseenheid),
    tag('Omschrijving', c.omschrijving_snapshot ?? ''),
    // ScanCode MOET exact de barcode op de eenheid zijn. Onze labels dragen
    // AI(00)+SSCC (shipping-label.tsx: `00${sscc}`); of Verhoek de prefix
    // wil is een open vraag → configureerbaar.
    tag('ScanCode', opties.scancode_met_00_prefix ? `00${c.sscc}` : c.sscc),
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
    ...partijTags('AfwijkendeAfzender', karpi),
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
