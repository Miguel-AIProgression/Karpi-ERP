// Builder voor Karpi DESADV (verzendbevestiging) naar Transus.
//
// ⚠️  FORMAT-STATUS: ONBEKEND — GEBLOKKEERD OP TAAK 12
//
// Het exacte Transus-payload-formaat voor DESADV (verzendberichten / DESADV /
// APERAK) is nog niet vastgesteld. De INVOIC gebruikt fixed-width "Custom ERP"
// (Transus-Online ID 17653, versie 10) — maar DESADV gebruikt mogelijk een
// afwijkend formaat (bijv. TransusXML zoals ORDRSP, of ook fixed-width).
//
// Er is geen historisch voorbeeld in docs/transus/voorbeelden/ en de Transus
// "Testen"-tab is nog niet doorlopen voor DESADV.
//
// GEVOLG: `buildKarpiVerzendbericht` gooit bewust een fout totdat:
//   - Miguel een voorbeeldbestand heeft gedownload uit Transus Online (Task 12)
//   - Het formaat is gereverse-engineerd en de builder is geïmplementeerd (Task 12)
//   - Een rondreis-test in de Transus Testen-tab geslaagd is (Task 12, stap 5)
//
// De input-interface `VerzendberichtInput` is echter al bevroren (Task 11),
// omdat Task 13 (`bouw-verzendbericht-edi` edge function) er al tegenaan bouwt.
// Zodra Task 12 klaar is, hoeft alleen de builder hieronder ingevuld te worden
// — de rest van de infrastructuur staat klaar.
//
// Zie: docs/superpowers/plans/2026-06-11-universele-communicatie-knoppen.md (slice 4, Task 12)

/**
 * Eén orderregel in het verzendbevestiging-bericht.
 */
export interface VerzendberichtRegel {
  /** Volgnummer van de regel (1-gebaseerd). */
  regelnummer: number;
  /** GTIN/EAN-barcode van het artikel — null als het artikel geen EAN heeft in producten. */
  gtin: string | null;
  /** Eigen artikelcode (producten.artikelnr). */
  artikelcode: string | null;
  /** Artikelomschrijving voor leesbaarheid in het bericht. */
  omschrijving: string | null;
  /** Geleverd aantal. */
  aantal: number;
}

/**
 * Invoer voor de DESADV-builder. Alle partijvelden zijn GLN-codes van het
 * EDIFACT NAD-segment zoals Transus die verwacht.
 */
export interface VerzendberichtInput {
  /** Karpi-intern zendingnummer (zendingen.zending_nr, bijv. 'ZEND-2026-0042'). */
  zendingNr: string;
  /** Feitelijke verzenddatum (ISO YYYY-MM-DD, zendingen.verzenddatum). */
  verzenddatum: string;
  /** Bevestigde afleverdatum (ISO YYYY-MM-DD, orders.afleverdatum). */
  leverdatum: string;
  /**
   * Inkoopordernummer van de koper — klant-PO zoals de partner die heeft
   * meegestuurd in het inkomende EDI-bericht (orders.klant_referentie snapshot
   * of inbound edi_berichten.payload_parsed.orderNumberBuyer).
   */
  orderNumberBuyer: string;
  /** Ons eigen ordernummer (orders.order_nr, bijv. 'ORD-2026-0334'). NAD+SU-referentie. */
  orderNumberSupplier: string;
  /**
   * Karpi-GLN — NAD+SU (afzender leverancier).
   * Uit app_config 'bedrijfsgegevens'.gln_eigen, fallback '8715954999998'.
   */
  senderGln: string;
  /**
   * Partner-GLN (factuur-entiteit) — NAD+IV (invoice party / recipient).
   * Uit edi_handelspartner_config of orders.factuuradres_gln snapshot.
   */
  recipientGln: string;
  /**
   * Koper-GLN — NAD+BY (buyer).
   * Uit orders.besteller_gln snapshot.
   */
  buyerGln: string;
  /**
   * Afleveradres-GLN — NAD+DP (delivery party).
   * Uit orders.afleveradres_gln snapshot.
   */
  deliveryPartyGln: string;
  /**
   * Tracking-/transportordernummer van de vervoerder (zendingen.track_trace).
   * Null als de vervoerder nog geen tracking-nummer heeft teruggekoppeld.
   */
  trackingNummer: string | null;
  /** Stuur dit als testbericht via Transus? (edi_handelspartner_config.test_modus). */
  isTestMessage: boolean;
  /** Regels in het verzendbevestiging-bericht (minimaal 1). */
  regels: VerzendberichtRegel[];
}

/**
 * Valideert de invoer voor de DESADV-builder.
 * Gooit een Error bij ontbrekende verplichte velden.
 */
export function valideerVerzendberichtInput(input: VerzendberichtInput): undefined {
  if (!input.senderGln) {
    throw new Error('VerzendberichtInput: senderGln (Karpi-GLN NAD+SU) is verplicht');
  }
  if (!input.recipientGln) {
    throw new Error('VerzendberichtInput: recipientGln (partner factuur-GLN NAD+IV) is verplicht');
  }
  if (!input.buyerGln) {
    throw new Error('VerzendberichtInput: buyerGln (koper-GLN NAD+BY) is verplicht');
  }
  if (!input.deliveryPartyGln) {
    throw new Error('VerzendberichtInput: deliveryPartyGln (afleveradres-GLN NAD+DP) is verplicht');
  }
  if (!input.orderNumberBuyer) {
    throw new Error('VerzendberichtInput: orderNumberBuyer (klant-PO) is verplicht');
  }
  if (!input.regels || input.regels.length === 0) {
    throw new Error('VerzendberichtInput: regels mag niet leeg zijn');
  }
  return undefined;
}

/**
 * Bouwt het Karpi DESADV-bericht voor Transus.
 *
 * ⚠️  GEBLOKKEERD: het formaat is nog niet gereverse-engineerd.
 * Deze functie gooit bewust een fout totdat Task 12 (format-validatie) klaar is.
 * De infrastructuur er omheen (Task 13 edge function, Task 14 cron) staat klaar.
 */
export function buildKarpiVerzendbericht(_input: VerzendberichtInput): string {
  valideerVerzendberichtInput(_input);
  throw new Error(
    'Verzendbericht-format nog niet gevalideerd tegen Transus — ' +
    'zie docs/superpowers/plans/2026-06-11-universele-communicatie-knoppen.md Task 12',
  );
}
