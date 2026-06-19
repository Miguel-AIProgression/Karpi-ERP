// Pure input- en output-types voor de canonieke pakbon-laag (ADR-0033: gedeeld
// edge ↔ frontend). De input-types zijn STRUCTUREEL compatibel met de frontend
// `ZendingPrintSet`/`ZendingPrintRegel` (queries/zendingen.ts) — TypeScript
// structural typing zorgt dat de frontend zijn bestaande objecten kan doorgeven
// zonder een tweede fetch-shape te onderhouden. Hier staan alleen de velden die
// de pakbon nodig heeft.

export interface PakbonProduct {
  omschrijving: string | null
  gewicht_kg: number | null
}

export interface PakbonOrderRegel {
  /** Bron-order — voedt de bundel-groepering (mig 222). */
  order_id: number
  regelnummer: number | null
  artikelnr: string | null
  omschrijving: string | null
  omschrijving_2: string | null
  orderaantal: number | null
  te_leveren: number | null
  gewicht_kg: number | null
  is_maatwerk: boolean | null
  maatwerk_lengte_cm: number | null
  maatwerk_breedte_cm: number | null
  producten?: PakbonProduct | null
}

export interface PakbonRegelInput {
  id: number
  order_regel_id: number | null
  artikelnr: string | null
  aantal: number | null
  order_regels?: PakbonOrderRegel | null
}

export interface PakbonColliInput {
  colli_nr: number
  sscc: string
  order_regel_id: number | null
  omschrijving_snapshot: string | null
  klant_omschrijving_snapshot: string | null
  /** Mig 436: karpi_code van het fysiek gepakte (omgesticker) equivalent als dat
   *  afwijkt van het bestelde artikel. null = geen omsticker → geen "OMB:"-regel. */
  omsticker_snapshot: string | null
}

/**
 * Smalle input voor `bouwPakbonRegels`/`telColli` — exact wat de regel-aggregatie
 * leest, niet het volledige document. Zowel `PakbonZendingInput` (server) als de
 * frontend `ZendingPrintSet` voldoen er structureel aan, zodat één aggregatie
 * beide voedt zonder dat de frontend zijn `debiteuren.route`-loze orders-shape
 * hoeft uit te breiden.
 */
export interface PakbonRegelsInput {
  orders: { id: number }
  zending_regels: PakbonRegelInput[]
  zending_colli: PakbonColliInput[]
}

export interface PakbonBundelOrder {
  id: number
  order_nr: string
  klant_referentie: string | null
  week: string | null
}

export interface PakbonZendingInput {
  zending_nr: string
  verzenddatum: string | null
  created_at: string
  afl_naam: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_plaats: string | null
  afl_land: string | null
  afl_telefoon: string | null
  aantal_colli: number | null
  totaal_gewicht_kg: number | null
  orders: {
    id: number
    order_nr: string
    klant_referentie: string | null
    week: string | null
    debiteur_nr: number
    vertegenw_code: string | null
    fact_naam: string | null
    fact_adres: string | null
    fact_postcode: string | null
    fact_plaats: string | null
    fact_land: string | null
    afl_naam_2: string | null
    debiteuren?: { naam: string | null } | null
    vertegenwoordigers?: { naam: string | null } | null
  }
  bundel_orders: PakbonBundelOrder[]
  zending_regels: PakbonRegelInput[]
  zending_colli: PakbonColliInput[]
}

/** De bevroren omschrijving-snapshot van een colli (mig 209/388). */
export interface OmschrijvingSnapshot {
  omschrijvingSnapshot: string | null
  klantOmschrijvingSnapshot: string | null
}

/**
 * Eén pakbonregel = één fysieke orderregel in de zending (geaggregeerd over de
 * colli's). De besteld/geleverd/gewicht-formules zijn bewust gelijk aan de
 * historische pakbon-logica (frontend `printset.ts` → `pakbonRegels`).
 */
export interface PakbonRegel {
  regel: PakbonRegelInput
  orderRegelId: number | null
  /** Bron-order voor groepering per orderbevestiging (mig 222). */
  orderId: number
  /** `order_regels.orderaantal`, fallback geleverd. */
  besteld: number
  /** Geleverd in deze zending — ladder `aantal ?? te_leveren ?? orderaantal ?? 1`. */
  geleverd: number
  /** `regelgewicht × geleverd` — opgeteld levert dit het zending-totaal. */
  gewichtKg: number
  /** Mig 388-snapshot uit de eerste colli van deze regel, of `null` (legacy). */
  snapshot: OmschrijvingSnapshot | null
  /** Mig 436: unieke omsticker-codes (karpi_code van het fysiek gepakte
   *  equivalent) over de colli van deze regel. Leeg = geen omsticker. De pakbon
   *  toont ze als "OMB:"-subregel, net als het verzendlabel. */
  omstickerCodes: string[]
}

/** Eén bundel-groep voor de pakbon: een bron-order met zijn regels. */
export interface PakbonOrderGroep {
  orderId: number
  /** order_nr van de bron-order, of null als die niet in bundel_orders zit. */
  orderNr: string | null
  regels: PakbonRegelDisplay[]
}

/** Een pakbonregel mét opgeloste presentatie-strings (klaar om te renderen). */
export interface PakbonRegelDisplay {
  regelnummer: string
  artikelnr: string
  /** Hoofdomschrijving (Karpi-naam, of klant-naam als die er niet is). */
  hoofdNaam: string
  /** "Uw naam: …" — alleen gezet als die afwijkt van de hoofdnaam. */
  uwNaam: string | null
  /** Losse maat-regel, alleen bij legacy-maatwerk zonder colli-snapshot. */
  maatRegel: string | null
  /** Mig 436: unieke omsticker-codes (fysiek gepakt equivalent). Leeg = geen
   *  "OMB:"-subregel. Zelfde notatie als het verzendlabel. */
  omstickerCodes: string[]
  besteld: string
  geleverd: string
}

/** Bedrijfsgegevens voor de pakbon-header/footer (app_config 'bedrijfsgegevens'). */
export interface PakbonBedrijf {
  bedrijfsnaam: string
  adres: string
  postcode: string
  plaats: string
  land: string
  telefoon: string
  email: string
  website: string
  fax?: string
  kvk: string
  btw_nummer: string
  bank: string
  iban: string
  bic: string
  betalingscondities_tekst?: string
}

/**
 * Canoniek pakbon-document: alle presentatie-beslissingen zijn hier al genomen
 * (welke tekst, welke groepering, welke totalen). De pdf-lib-renderer doet alleen
 * nog de lay-out. Dit is de single source die in de eindstaat (na verwijderen van
 * de React-pakbon) de enige pakbon-afleiding is.
 */
export interface PakbonDocument {
  pakbonnr: string
  datum: string
  /** Afleveradres-blok (regels, leeg gefilterd). */
  afleveradres: string[]
  afleverTelefoon: string | null
  /** Factuuradres-blok (regels, leeg gefilterd). */
  factuuradres: string[]
  isBundel: boolean
  /** Referentie-meta links onder het adres (solo) of bundel-lijst. */
  referentieRegel: string
  vertegenwoordiger: string
  orderDebiteur: string
  debiteur: string
  routecode: string | null
  /** Bundel: identificerende regels per order ("· ORD-… : Ref. …"). */
  bundelRegels: string[]
  groepen: PakbonOrderGroep[]
  kolli: number
  totaalGewichtKg: number
}
