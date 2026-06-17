// Verhoek-specifieke types voor de verhoek-send edge function.
// Bron-van-waarheid: XMLstandardVerhoekEuropeAA20.xml (voorbeeld Verhoek) +
// eisen-mail Gerrit Altena. Leeft bewust binnen de verticale slice.
// Plan: docs/superpowers/plans/2026-06-11-verhoek-transporteur-xml-sftp.md

export interface ZendingInput {
  zending_nr: string;
  afl_naam: string | null;
  afl_adres: string | null;
  afl_postcode: string | null;
  afl_plaats: string | null;
  afl_land: string | null;
  afl_telefoon: string | null;
  afl_email: string | null;
  opmerkingen: string | null;
  verzenddatum: string | null; // ISO 'YYYY-MM-DD'
}

export interface OrderInput {
  order_nr: string;
}

export interface BedrijfInput {
  bedrijfsnaam: string;
  adres: string;
  postcode: string;
  plaats: string;
  land: string;
  telefoon: string;
  email: string;
}

// Eén colli mét afgeleide afmetingen (cm). lengte/breedte komen uit
// order_regels.maatwerk_*_cm → fallback producten.*_cm (orchestrator levert
// ze plat aan zodat de builder puur blijft).
export interface VerhoekColliInput {
  colli_nr: number;
  sscc: string | null;
  gewicht_kg: number | null;
  omschrijving_snapshot: string | null;
  artikelnr: string | null;
  lengte_cm: number | null;
  breedte_cm: number | null;
}

// Colli-preflight-probleem: gedeelde shape (ADR-0034, _shared/vervoerders/colli.ts).
export type { ColliProbleem } from '../_shared/vervoerders/colli.ts';

// Runtime-config uit app_config sleutel 'verhoek' (mig 374). Antwoorden van
// Verhoek = SQL-UPDATE op dat record, geen redeploy (ADR-0031).
export interface VerhoekOpties {
  /** Karpi's klantnummer bij Verhoek. '' = nog onbekend (vraag 1 testmail). */
  opdrachtgever_nummer: string;
  // ScanCode = de labelbarcode (AI(00)+SSCC) uit _shared/vervoerders/
  // labelbarcode.ts — niet langer een per-carrier config-vlag, zodat label en
  // aanmelding nooit kunnen divergeren (de HST-overlossing-klasse bug).
  // Fallback-Verpakkingseenheid als de colli-afmeting onbekend is. Normaal
  // leidt de builder de eenheid per colli af (Karpet/Loper/Coupon) uit de
  // afmetingen — Karpi verstuurt via Verhoek nooit volle rollen (mail Verhoek
  // 16-06-2026), dus 'Rol' (≥1251 cm) komt niet voor.
  verpakkingseenheid: string;
  levering: string;           // vraag 2 testmail
  soort_levering: string;     // vraag 2 testmail
}

export const DEFAULT_VERHOEK_OPTIES: VerhoekOpties = {
  opdrachtgever_nummer: '',
  verpakkingseenheid: 'Coupon',
  levering: '1',
  soort_levering: '1',
};

export interface BouwVerhoekXmlArgs {
  zending: ZendingInput;
  order: OrderInput;
  bedrijf: BedrijfInput;
  opties: VerhoekOpties;
  colli: VerhoekColliInput[];
}
