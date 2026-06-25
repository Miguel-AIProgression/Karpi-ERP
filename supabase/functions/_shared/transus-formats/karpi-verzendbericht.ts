// Builder voor Karpi fixed-width DESADV (verzendbericht/pakbon) naar Transus "Custom ERP".
//
// Reverse-engineered uit een echt Hornbach NL verzendbericht, verstuurd door het
// oude Windows Connect-systeem op 2026-06-11:
// - Bron:    docs/transus/voorbeelden/verzendbericht-uit-hornbach-172390327.txt
//            (byte-identiek aan EDI/Bericht-ID 172390327.zip, sha256 986e57a3...)
// - EDIFACT: docs/transus/voorbeelden/edifact-output-desadv-hornbach-172390327.edi
//            (D:01B DESADV zoals Hornbach het ontvangt — gebruikt om de betekenis
//            van elk bron-veld vast te stellen)
//
// Transus vertaalt deze fixed-width input naar EDIFACT D:01B DESADV (EAN007).
//
// REGELSTRUCTUUR (records gescheiden door CRLF, bestand eindigt op CRLF):
//   - Header (record-type '0'): 291 bytes vaste breedte
//   - Article (record-type '1'): 245 bytes vaste breedte, 1+ keer
//
// KOLOMKAART HEADER (offsets 0-based, einde exclusief — gevalideerd byte-exact
// tegen bericht-ID 172390327):
//   [  0,  1) recordType            '0' constant
//   [  1,  9) pakbonNummer          8 cijfers, links zero-padded → BGM+351 + RFF+DQ
//   [  9, 63) filler                54 spaties
//   [ 63, 71) documentDatum         YYYYMMDD (verzenddatum) → DTM+137
//   [ 71, 79) filler                8 spaties (mogelijk 2e datum-slot, leeg in voorbeeld)
//   [ 79, 87) leverDatum            YYYYMMDD → DTM+2
//   [ 87,103) filler                16 spaties
//   [103,117) partnerNaam           14 chars links, afgekapt ('Hornbach Bauma')
//   [117,130) recipientGln          13 cijfers → UNB-recipient (Transus-routering,
//                                   zelfde rol als recipientGln [97,110) in INVOIC)
//   [130,143) buyerGln              13 cijfers → NAD+BY
//   [143,156) deliveryPartyGln      13 cijfers → NAD+DP
//   [156,182) filler                26 spaties (mogelijk 2 lege GLN-slots van 13)
//   [182,195) supplierGln           13 cijfers → NAD+SU (Karpi)
//   [195,196) testFlag              'N' / 'Y'
//   [196,231) filler                35 spaties
//   [231,239) supplierOrderNumber   8 cijfers, links zero-padded (oud-systeem '26581310';
//                                   RugFlow 'ORD-2026-0334' → laatste 8 cijfers '20260334',
//                                   zelfde normalisatie als INVOIC supplierOrderNumber)
//   [239,291) filler                52 spaties
//
// KOLOMKAART ARTICLE:
//   [  0,  1) recordType            '1' constant (alle regels, cf. order-in-format)
//   [  1, 39) filler                38 spaties
//   [ 39, 48) artikelcode           9 chars links — EIGEN Karpi-artikelnr ('493430001'
//                                   = TEDDY 43, zelfde patroon als INVOIC supplier-
//                                   ArticleNumber '838430031' = LENA 43); verschijnt
//                                   NIET in de EDIFACT (geen PIA-segment)
//   [ 48, 83) omschrijving          35 chars links ('TEDDY Kleur 43 CA: 060x090 cm')
//   [ 83, 96) gtin                  13 cijfers → LIN ...:EN
//   [ 96,165) filler                69 spaties
//   [165,182) aantal                17 chars, '%017.2f'-stijl ('00000000000005.00')
//                                   → QTY+12 (geleverd aantal)
//   [182,202) filler                20 spaties
//   [202,208) regelnummer           6 cijfers zero-padded → LIN-regelnummer
//   [208,243) orderNumberBuyer      klant-PO links ('7270257662') → RFF+ON (header én
//                                   per regel — Transus tilt de regel-PO naar de header)
//   [243,245) filler                2 spaties
//
// AANNAMES (1 voorbeeld + EDIFACT — validatiepunten voor de Transus Testen-tab):
// - AANNAME: artikelcode-veldbreedte is 9 ([39,48)); pos 38 is spatie in het
//   voorbeeld, dus géén 10-breed zero-padded veld zoals in de INVOIC.
// - AANNAME: orderNumberBuyer-breedte is 35 ([208,243), spiegelt INVOIC
//   ART.orderNumberBuyer); in het voorbeeld is alleen 10 chars gevuld.
// - AANNAME: [202,208) is óns regelnummer (LIN); bij EDI-orders is
//   order_regels.regelnummer toch al het regelnummer van de inkomende order.
// - AANNAME: recipientGln = orders.factuuradres_gln (Hornbach-routering
//   '4306517008994' = gefactureerd-GLN van de inkomende order) — spiegelt
//   factuur-invoice-renderer.ts (recipientGln ← order.factuuradres.gln).
// - Tracking-nummer heeft GÉÉN slot in dit format (ook niet in de EDIFACT);
//   het veld is daarom uit VerzendberichtInput verwijderd.
//
// Charset: windows-1252 richting Transus (zie SOAP-client); deze builder werkt
// met Unicode-strings.

/**
 * Eén orderregel in het verzendbevestiging-bericht.
 */
export interface VerzendberichtRegel {
  /** Volgnummer van de regel (1-gebaseerd) → LIN-regelnummer, [202,208). */
  regelnummer: number;
  /** GTIN/EAN-barcode van het artikel → LIN, [83,96). Verplicht — enige artikel-identificatie in de EDIFACT. */
  gtin: string | null;
  /** Eigen artikelcode (producten.artikelnr), [39,48) — informatief, niet vertaald naar EDIFACT. */
  artikelcode: string | null;
  /** Artikelomschrijving voor leesbaarheid in het bericht, [48,83). */
  omschrijving: string | null;
  /** Geleverd aantal → QTY+12, [165,182). */
  aantal: number;
  /** Klant-PO per regel → RFF+ON, [208,243). Null → header-orderNumberBuyer. */
  orderNumberBuyer?: string | null;
}

/**
 * Invoer voor de DESADV-builder. Alle partijvelden zijn GLN-codes van het
 * EDIFACT NAD-segment zoals Transus die verwacht.
 */
export interface VerzendberichtInput {
  /**
   * Karpi-intern zendingnummer (zendingen.zending_nr, bijv. 'ZEND-2026-0042').
   * Wordt genormaliseerd naar 8 cijfers (laatste 8, zero-padded) → pakbonnr
   * [1,9) → BGM+351 + RFF+DQ. Het oude systeem gebruikte 8-cijferige
   * pakbonnummers ('00456666').
   */
  zendingNr: string;
  /** Feitelijke verzenddatum (ISO YYYY-MM-DD, zendingen.verzenddatum) → DTM+137, [63,71). */
  verzenddatum: string;
  /** Bevestigde afleverdatum (ISO YYYY-MM-DD, orders.afleverdatum) → DTM+2, [79,87). */
  leverdatum: string;
  /**
   * Inkoopordernummer van de koper — klant-PO zoals de partner die heeft
   * meegestuurd in het inkomende EDI-bericht (orders.klant_referentie).
   * → RFF+ON, op de artikel-regels [208,243).
   */
  orderNumberBuyer: string;
  /**
   * Ons eigen ordernummer (orders.order_nr, bijv. 'ORD-2026-0334').
   * Wordt genormaliseerd naar 8 cijfers (laatste 8: '20260334') → [231,239),
   * zelfde normalisatie als INVOIC supplierOrderNumber.
   */
  orderNumberSupplier: string;
  /** Partnernaam (debiteuren.naam), afgekapt op 14 chars → [103,117). */
  partnerNaam: string | null;
  /**
   * Karpi-GLN — NAD+SU (afzender leverancier), [182,195).
   * Uit app_config 'bedrijfsgegevens'.gln_eigen, fallback '8715954999998'.
   */
  senderGln: string;
  /**
   * Partner-routerings-GLN → UNB-recipient, [117,130).
   * Uit orders.factuuradres_gln (gefactureerd-GLN van de inkomende order) —
   * spiegelt factuur-invoice-renderer.ts. Hornbach: '4306517008994'.
   */
  recipientGln: string;
  /** Koper-GLN — NAD+BY, [130,143). Uit orders.besteller_gln snapshot. */
  buyerGln: string;
  /** Afleveradres-GLN — NAD+DP, [143,156). Uit orders.afleveradres_gln snapshot. */
  deliveryPartyGln: string;
  /** Stuur dit als testbericht via Transus? (edi_handelspartner_config.test_modus) → [195,196). */
  isTestMessage: boolean;
  /** Regels in het verzendbevestiging-bericht (minimaal 1). */
  regels: VerzendberichtRegel[];
}

const HEADER_LEN = 291;
const ARTICLE_LEN = 245;

const HDR = {
  recordType: [0, 1] as const,
  pakbonNummer: [1, 9] as const,
  documentDatum: [63, 71] as const,
  leverDatum: [79, 87] as const,
  partnerNaam: [103, 117] as const,
  recipientGln: [117, 130] as const,
  buyerGln: [130, 143] as const,
  deliveryPartyGln: [143, 156] as const,
  supplierGln: [182, 195] as const,
  testFlag: [195, 196] as const,
  supplierOrderNumber: [231, 239] as const,
};

const ART = {
  recordType: [0, 1] as const,
  artikelcode: [39, 48] as const,
  omschrijving: [48, 83] as const,
  gtin: [83, 96] as const,
  aantal: [165, 182] as const,
  regelnummer: [202, 208] as const,
  orderNumberBuyer: [208, 243] as const,
};

/**
 * Valideert de invoer voor de DESADV-builder.
 * Gooit een Error bij ontbrekende verplichte velden.
 */
export function valideerVerzendberichtInput(input: VerzendberichtInput): undefined {
  if (!input.zendingNr) {
    throw new Error('VerzendberichtInput: zendingNr is verplicht');
  }
  if (!input.verzenddatum) {
    throw new Error('VerzendberichtInput: verzenddatum (ISO YYYY-MM-DD) is verplicht');
  }
  if (!input.leverdatum) {
    throw new Error('VerzendberichtInput: leverdatum (orders.afleverdatum) is verplicht');
  }
  if (!input.senderGln) {
    throw new Error('VerzendberichtInput: senderGln (Karpi-GLN NAD+SU) is verplicht');
  }
  if (!input.recipientGln) {
    throw new Error('VerzendberichtInput: recipientGln (partner-routerings-GLN, UNB-recipient) is verplicht');
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
  if (!input.orderNumberSupplier) {
    throw new Error('VerzendberichtInput: orderNumberSupplier (orders.order_nr) is verplicht');
  }
  if (!input.regels || input.regels.length === 0) {
    throw new Error('VerzendberichtInput: regels mag niet leeg zijn');
  }
  input.regels.forEach((regel, i) => {
    // GTIN is de enige artikel-identificatie in de EDIFACT DESADV (LIN ...:EN)
    // — zonder GTIN is de regel betekenisloos voor de partner.
    if (!regel.gtin) {
      throw new Error(`VerzendberichtInput: regels[${i}] (regelnummer ${regel.regelnummer}) mist GTIN`);
    }
  });
  return undefined;
}

/**
 * Bouwt het Karpi fixed-width DESADV-bericht voor Transus.
 * Gevalideerd byte-identiek tegen bericht-ID 172390327 (Hornbach NL, 2026-06-11).
 */
export function buildKarpiVerzendbericht(input: VerzendberichtInput): string {
  valideerVerzendberichtInput(input);
  const header = buildHeaderLine(input);
  const lines = input.regels.map((regel) => buildArticleLine(regel, input));
  return [header, ...lines, ''].join('\r\n');
}

/**
 * Leverbonnummer (BGM+351 + RFF+DQ) — moet UNIEK zijn per uitgaand DESADV.
 * Eén fysieke zending kan ≥2 orders bundelen (mig 222) ÉN één order kan over
 * ≥2 zendingen verdeeld zijn (deelzending) — alleen het paar (zending, order)
 * is uniek per bericht. Daarom: laatste 4 cijfers van het zendingnummer +
 * laatste 4 van het ordernummer (8 cijfers, past in het veld).
 * Vóór 2026-06-24 enkel zendingNr → bundel-orders deelden hetzelfde nummer,
 * Hornbach weigerde de 2e ("delivery note number already used", 2026-06-22).
 * Puur orderNr zou de spiegel-bug geven (deelzending → 2 berichten, 1 ordernr).
 */
function leverbonNummer(zendingNr: string, orderNr: string): string {
  const z = zendingNr.replace(/\D/g, '').slice(-4).padStart(4, '0');
  const o = orderNr.replace(/\D/g, '').slice(-4).padStart(4, '0');
  return z + o;
}

function buildHeaderLine(input: VerzendberichtInput): string {
  const buf = new Array<string>(HEADER_LEN).fill(' ');

  setRange(buf, HDR.recordType, '0');
  setRange(buf, HDR.pakbonNummer, leverbonNummer(input.zendingNr, input.orderNumberSupplier));
  setRange(buf, HDR.documentDatum, formatDateYmd(input.verzenddatum));
  setRange(buf, HDR.leverDatum, formatDateYmd(input.leverdatum));
  setRange(buf, HDR.partnerNaam, fixed(input.partnerNaam ?? '', 14));
  setRange(buf, HDR.recipientGln, fixed(input.recipientGln, 13));
  setRange(buf, HDR.buyerGln, fixed(input.buyerGln, 13));
  setRange(buf, HDR.deliveryPartyGln, fixed(input.deliveryPartyGln, 13));
  setRange(buf, HDR.supplierGln, fixed(input.senderGln, 13));
  setRange(buf, HDR.testFlag, input.isTestMessage ? 'Y' : 'N');
  setRange(buf, HDR.supplierOrderNumber, formatDocumentNumber(input.orderNumberSupplier, 8));

  return buf.join('');
}

function buildArticleLine(regel: VerzendberichtRegel, input: VerzendberichtInput): string {
  const buf = new Array<string>(ARTICLE_LEN).fill(' ');

  setRange(buf, ART.recordType, '1');
  setRange(buf, ART.artikelcode, fixed(regel.artikelcode ?? '', 9));
  setRange(buf, ART.omschrijving, fixed(regel.omschrijving ?? '', 35));
  setRange(buf, ART.gtin, fixed(regel.gtin ?? '', 13));
  setRange(buf, ART.aantal, formatAmount(regel.aantal, 17));
  setRange(buf, ART.regelnummer, padLeft(String(regel.regelnummer), 6, '0'));
  setRange(buf, ART.orderNumberBuyer, fixed(regel.orderNumberBuyer ?? input.orderNumberBuyer, 35));

  return buf.join('');
}

// ---------------------------------------------------------------------------
// Format-helpers (zelfde conventies als karpi-invoice-fixed-width.ts)
// ---------------------------------------------------------------------------

function setRange(buf: string[], range: readonly [number, number], value: string): void {
  for (let i = 0; i < value.length && range[0] + i < range[1]; i++) {
    buf[range[0] + i] = value[i];
  }
}

function fixed(value: string, len: number): string {
  const clean = cleanText(value);
  if (clean.length >= len) return clean.slice(0, len);
  return clean + ' '.repeat(len - clean.length);
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function padLeft(value: string, len: number, pad = ' '): string {
  if (value.length >= len) return value.slice(0, len);
  return pad.repeat(len - value.length) + value;
}

function formatDateYmd(value: string): string {
  if (/^\d{8}$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10).replace(/-/g, '');
  throw new Error(`Ongeldige datum voor Karpi DESADV fixed-width: "${value}"`);
}

function formatDocumentNumber(value: string, len: number): string {
  const digits = value.replace(/\D/g, '');
  const source = digits || cleanText(value);
  return padLeft(source.slice(-len), len, '0');
}

function formatAmount(value: number, len: number): string {
  return padLeft(value.toFixed(2), len, '0');
}
