// Rhenus-specifieke types voor de rhenus-send edge function.
// Bron-van-waarheid: legacy RHE260521001.xml (excerpt + toelichting in
// docs/rhenus/voorbeelden/) + mails Rhenus 12-06-2026. Leeft bewust binnen de
// verticale slice (spiegel verhoek-send/types.ts).
// Plan: docs/superpowers/plans/2026-06-12-rhenus-transporteur-gs1-xml-sftp.md

export interface ZendingInput {
  zending_nr: string;
  afl_naam: string | null;
  afl_adres: string | null; // één regel (straat+nummer) — GS1 streetAddressOne, geen split
  afl_postcode: string | null;
  afl_plaats: string | null;
  afl_land: string | null;
  afl_telefoon: string | null;
  verzenddatum: string | null; // ISO 'YYYY-MM-DD'
}

export interface OrderInput {
  order_nr: string;
  klant_referentie: string | null; // → Freetext "Order <nr> Ref <referentie>"
}

export interface BedrijfInput {
  bedrijfsnaam: string;
  adres: string;
  postcode: string;
  plaats: string;
  land: string;
  telefoon: string;
  email: string;
  /** Karpi's eigen GLN (afzender in de SBDH). Bron: app_config
   *  bedrijfsgegevens.gln_eigen (mig 156). Ontbreekt → KARPI_GLN-fallback in
   *  xml-builder, zoals alle andere outbound-kanalen. */
  gln_eigen?: string;
}

// Eén colli. lengte_cm → dimension/depth. Een rol stuurt alléén depth (RLEN);
// een pallet-bundel (mig 489: pallet_type 'PLTS'/'HPLT') stuurt packageTypeCode =
// pallet_type ÉN depth+width (breedte_cm = de pallet-footprint-breedte). pallet_type
// is NULL voor losse colli en niet-pallet-bundels (dan: RLEN, alleen depth).
export interface RhenusColliInput {
  colli_nr: number;
  sscc: string | null;
  gewicht_kg: number | null;
  lengte_cm: number | null;
  breedte_cm: number | null;
  pallet_type?: string | null;
  // Mig 490: laadhoogte (cm) van een pallet-bundel → <dimension><height>. NULL voor
  // rollen/los; alleen relevant bij pallet_type PLTS/HPLT.
  hoogte_cm?: number | null;
}

// Colli-preflight-probleem: gedeelde shape (ADR-0034, _shared/vervoerders/colli.ts).
export type { ColliProbleem } from '../_shared/vervoerders/colli.ts';

// Runtime-config uit app_config sleutel 'rhenus' (mig 379). Wijziging =
// SQL-UPDATE op dat record, geen redeploy (ADR-0032).
export interface RhenusOpties {
  // <sscc> = de labelbarcode (AI(00)+SSCC) uit _shared/vervoerders/
  // labelbarcode.ts — niet langer een per-carrier config-vlag, zodat label en
  // aanmelding nooit kunnen divergeren (de HST-overlossing-klasse bug).
  /** GS1 packageTypeCode per colli. Legacy kende RLEN/COLL/PLTS/HPLT;
   *  onze zendingen zijn rollen → default 'RLEN'. */
  package_type_code: string;
  /** Eerste segment van de bestandsnaam op de SFTP (legacy: 'RHE'). */
  bestandsnaam_prefix: string;
}

export const DEFAULT_RHENUS_OPTIES: RhenusOpties = {
  package_type_code: 'RLEN',
  bestandsnaam_prefix: 'RHE',
};

export interface BouwRhenusXmlArgs {
  zending: ZendingInput;
  order: OrderInput;
  bedrijf: BedrijfInput;
  opties: RhenusOpties;
  colli: RhenusColliInput[];
  /** Tijdstip voor CreationDateAndTime/creationDateTime — geïnjecteerd zodat
   *  de builder puur en testbaar blijft. */
  nu: Date;
}
