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
}

// Eén colli. lengte_cm → dimension/depth (legacy stuurt voor rollen alleen
// depth; breedte_cm reist mee voor evt. latere pallet-ondersteuning maar
// wordt in V1 niet uitgestuurd).
export interface RhenusColliInput {
  colli_nr: number;
  sscc: string;
  gewicht_kg: number | null;
  lengte_cm: number | null;
  breedte_cm: number | null;
}

export interface ColliProbleem {
  colli_nr: number;
  veld: 'aantal' | 'sscc' | 'gewicht_kg' | 'lengte_cm';
  melding: string;
}

// Runtime-config uit app_config sleutel 'rhenus' (mig 378). Wijziging =
// SQL-UPDATE op dat record, geen redeploy (ADR-0032).
export interface RhenusOpties {
  /** true = <sscc> is de volledige label-waarde 00+SSCC (20 cijfers, zoals
   *  legacy én ons label); false = kale 18-cijferige SSCC. */
  sscc_met_00_prefix: boolean;
  /** GS1 packageTypeCode per colli. Legacy kende RLEN/COLL/PLTS/HPLT;
   *  onze zendingen zijn rollen → default 'RLEN'. */
  package_type_code: string;
  /** Eerste segment van de bestandsnaam op de SFTP (legacy: 'RHE'). */
  bestandsnaam_prefix: string;
}

export const DEFAULT_RHENUS_OPTIES: RhenusOpties = {
  sscc_met_00_prefix: true,
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
