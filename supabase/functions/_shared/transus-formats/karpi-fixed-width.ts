// Karpi fixed-width parser/builder voor Transus "Custom ERP" gegevensbron
// (ID 17653, versie 10, type "Fixed length", actief sinds 2023-01-31).
//
// Dit is het format dat Transus genereert voor Karpi op basis van inkomende EDIFACT
// (D96A ORDERS van handelspartners). Geen publieke spec — kolomposities zijn
// reverse-engineered uit drie productie-bestanden op 2026-04-29:
//   docs/transus/voorbeelden/order-in-ostermann-168818626.inh  (rich)
//   docs/transus/voorbeelden/order-in-bdsk-168766180.inh       (sparse)
//   docs/transus/voorbeelden/factuur-uit-bdsk-166794659.txt    (outgoing INVOIC)
//
// Regelstructuur:
//   - Header (record-type "0"): 463 bytes vaste breedte
//   - Article (record-type "1"): 281 bytes vaste breedte, 1+ keer
//   - Records gescheiden door "\r\n" (Windows-CRLF) — we ondersteunen ook "\n"
//
// Charset: CP-1252 / windows-1252 voor umlauts in adressen (zie SOAP-client).
// Wij decoderen al naar Unicode in transus-soap.ts; deze parser gaat met UTF-8 strings om.

// ============================================================================
// Types
// ============================================================================

export interface KarpiOrderHeader {
  /** Ordernummer dat de afnemer aan de order heeft gegeven (klant-PO). */
  ordernummer: string;
  /** Gewenste leverdatum (ISO YYYY-MM-DD), null als niet opgegeven. */
  leverdatum: string | null;
  /** Vlag-string van 11 N/Y-tekens. Eerste positie lijkt IsTestMessage. */
  vlaggen: string;
  /** Naam afnemer / besteller (max 14 chars, getrunceerd door Transus). */
  afnemer_naam: string | null;
  /** GLN van de gefactureerde (NAD+IV). 13 cijfers. */
  gln_gefactureerd: string | null;
  /** Orderdatum (ISO YYYY-MM-DD). */
  orderdatum: string | null;
  /** GLN van de besteller (NAD+BY). */
  gln_besteller: string | null;
  /** GLN van het afleveradres (NAD+DP). */
  gln_afleveradres: string | null;
  /** GLN van de leverancier (NAD+SU = Karpi). */
  gln_leverancier: string;
  /** Test-flag: laatste karakter op pos 441. */
  test_flag: string;
}

export interface KarpiOrderRegel {
  /** Regelnummer in het bericht (1, 2, 3, ...). */
  regelnummer: number;
  /** GTIN / EAN-code (8/12/13/14 cijfers). */
  gtin: string;
  /** Artikelcode zoals door de klant of door Karpi gebruikt. */
  artikelcode: string | null;
  /** Aantal besteld (decimaal, bv. 1.000). */
  aantal: number;
  /** Ordernummer-referentie op regel-niveau (= header.ordernummer). */
  ordernummer_ref: string | null;
}

export interface KarpiOrder {
  header: KarpiOrderHeader;
  regels: KarpiOrderRegel[];
}

// ============================================================================
// Kolomposities (offsets zijn 0-based, einde is exclusief)
// ============================================================================

const HEADER_LEN = 463;
const ARTICLE_LEN = 281;

const HDR = {
  recordType: [0, 1] as const,
  ordernummer: [1, 13] as const,
  leverdatum: [44, 52] as const,
  vlaggen: [76, 87] as const,
  afnemerNaam: [157, 171] as const,
  glnGefactureerd: [171, 184] as const,
  orderdatum: [184, 192] as const,
  glnBesteller: [205, 218] as const,
  glnAfleveradres: [218, 231] as const,
  glnGefactureerd2: [231, 244] as const, // duplicate van [171,184]
  glnLeverancier: [257, 270] as const,
  glnLeverancier2: [283, 296] as const, // duplicate
  ordernummerRef: [366, 378] as const,
  testFlag: [441, 442] as const,
};

const ART = {
  recordType: [0, 1] as const,
  gtin: [59, 72] as const,
  artikelcode: [159, 194] as const,
  regelnummer: [194, 200] as const,
  aantal: [234, 239] as const,
  ordernummerRef: [239, 251] as const,
};

// ============================================================================
// Parser
// ============================================================================

const KARPI_GLN_DEFAULT = '8715954999998';

/**
 * Parse een ruw fixed-width Order-bericht (zoals geleverd door Transus M10110).
 * Gooit Error bij structurele afwijking; tolerant voor lege optionele velden.
 */
export function parseKarpiOrder(raw: string, options?: { karpiGln?: string }): KarpiOrder {
  // Splits op zowel CRLF als LF, filter lege regels (laatste line is vaak leeg).
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error(
      `Karpi-fixed-width parse error: minimaal 2 regels verwacht (header + ≥1 article), kreeg ${lines.length}`,
    );
  }

  // Transus kapt trailing spaces soms af. Productievoorbeelden uit 2026-04-30
  // hebben daardoor headerregels van 462 bytes en artikelregels van 280 bytes,
  // terwijl onze offset-tabel op 463/281 uitkomt.
  const HDR_MIN_LEN = HDR.testFlag[1];
  const ART_MIN_LEN = ART.ordernummerRef[1];

  const headerLine = padOrFail(lines[0], HEADER_LEN, HDR_MIN_LEN, 'header');
  if (slice(headerLine, HDR.recordType) !== '0') {
    throw new Error(
      `Karpi-fixed-width header: eerste karakter moet '0' zijn (record-type header), kreeg '${slice(headerLine, HDR.recordType)}'`,
    );
  }

  const header = parseHeader(headerLine);
  const regels: KarpiOrderRegel[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = padOrFail(lines[i], ARTICLE_LEN, ART_MIN_LEN, `article ${i}`);
    if (slice(line, ART.recordType) !== '1') {
      throw new Error(
        `Karpi-fixed-width article ${i}: record-type moet '1' zijn`,
      );
    }
    regels.push(parseArticle(line));
  }

  // Karpi-GLN-checksum: minstens één van de twee Karpi-GLN-velden moet matchen.
  const expectedGln = options?.karpiGln ?? KARPI_GLN_DEFAULT;
  if (
    header.gln_leverancier !== expectedGln &&
    header.gln_leverancier !== ''
  ) {
    // Niet hard falen — log via thrown ParseWarning kan later. Voor nu accepteren.
  }

  return { header, regels };
}

function parseHeader(line: string): KarpiOrderHeader {
  return {
    ordernummer: slice(line, HDR.ordernummer).trim(),
    leverdatum: parseDateOrNull(slice(line, HDR.leverdatum)),
    vlaggen: slice(line, HDR.vlaggen),
    afnemer_naam: nullIfBlank(slice(line, HDR.afnemerNaam)),
    gln_gefactureerd: nullIfBlank(slice(line, HDR.glnGefactureerd)),
    orderdatum: parseDateOrNull(slice(line, HDR.orderdatum)),
    gln_besteller: nullIfBlank(slice(line, HDR.glnBesteller)),
    gln_afleveradres: nullIfBlank(slice(line, HDR.glnAfleveradres)),
    gln_leverancier: slice(line, HDR.glnLeverancier).trim(),
    test_flag: slice(line, HDR.testFlag),
  };
}

function parseArticle(line: string): KarpiOrderRegel {
  const aantalRaw = slice(line, ART.aantal).trim();
  return {
    regelnummer: parseInt(slice(line, ART.regelnummer).trim(), 10) || 0,
    gtin: slice(line, ART.gtin).trim(),
    artikelcode: nullIfBlank(slice(line, ART.artikelcode)),
    aantal: parseFloat(aantalRaw) || 0,
    ordernummer_ref: nullIfBlank(slice(line, ART.ordernummerRef)),
  };
}

// ============================================================================
// Utilities
// ============================================================================

function padOrFail(line: string, expectedLen: number, minLen: number, label: string): string {
  if (line.length < minLen) {
    throw new Error(
      `Karpi-fixed-width ${label}: te kort (${line.length} bytes, minimaal ${minLen} nodig voor alle data-velden)`,
    );
  }
  if (line.length < expectedLen) {
    return line + ' '.repeat(expectedLen - line.length);
  }
  if (line.length > expectedLen + 5) {
    throw new Error(
      `Karpi-fixed-width ${label}: te lang (${line.length} bytes, verwacht max ${expectedLen + 5})`,
    );
  }
  return line;
}

function slice(line: string, range: readonly [number, number]): string {
  return line.substring(range[0], range[1]);
}

function nullIfBlank(s: string): string | null {
  const trimmed = s.trim();
  return trimmed === '' ? null : trimmed;
}

function parseDateOrNull(s: string): string | null {
  // JJJJMMDD → YYYY-MM-DD; spaties of nullen → null
  const trimmed = s.trim();
  if (trimmed === '' || trimmed === '00000000') return null;
  if (!/^\d{8}$/.test(trimmed)) return null;
  return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
}

// ============================================================================
// IsTestMessage detectie
//
// Op basis van twee productie-voorbeelden zien we 'NNNNNNNNNNN' op pos 76-87.
// Het IsTestMessage-veld is volgens de Transus berichtspec een 'Y' / 'N' indicator.
// In de Custom ERP-uitvoer is de exacte positie niet hard bevestigd; we proberen
// alle 'Y' in de vlaggen-string en het laatste test_flag-karakter.
// ============================================================================

export function isTestMessage(header: KarpiOrderHeader): boolean {
  // Zowel een 'Y' in de hoofdvlaggen als het terminator-vlaggetje wijst op test.
  // Beide moeten standaard 'N' zijn voor productie-orders.
  return /Y/.test(header.vlaggen) || header.test_flag.toUpperCase() === 'Y';
}

// ============================================================================
// Berichttype-detectie
//
// Een fixed-width-bericht heeft geen expliciete type-header. We leiden af uit
// het eerste karakter en lengte:
//   - lengte 463 (header) + N×281 (article) ⇒ ORDER (inkomend)
//   - factuur-format heeft eigen lengtes (TODO bij INVOIC-builder)
// ============================================================================

export type FixedWidthBerichtType = 'order' | 'orderbev' | 'factuur' | 'verzendbericht' | 'unknown';

export function detectBerichttype(raw: string): FixedWidthBerichtType {
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const firstLine = lines[0] ?? '';
  const articleLines = lines.slice(1);
  const hasOrderShape =
    firstLine[0] === '0' &&
    firstLine.length >= HDR.testFlag[1] &&
    firstLine.length <= HEADER_LEN + 5 &&
    articleLines.length > 0 &&
    articleLines.every((line) =>
      line[0] === '1' &&
      line.length >= ART.ordernummerRef[1] &&
      line.length <= ARTICLE_LEN + 5
    );

  if (hasOrderShape) {
    return 'order';
  }
  // Factuur-format start eveneens met '0' maar heeft een ander veld-patroon
  // (zie factuur-uit-bdsk-166794659.txt). Voor nu: alleen 'order' herkennen.
  return 'unknown';
}

// ============================================================================
// Builder voor uitgaande Orderbevestiging (orderbev)
//
// Geen openbaar voorbeeld beschikbaar van Karpi's huidige orderbev-output.
// Werkhypothese: zelfde 463+281 fixed-width-template als de inkomende order,
// maar met onze GLN als afzender/leverancier en `Y` op het laatste flag-byte
// (pos 441) om "antwoord-bericht" te markeren. Onze partijen swappen:
//   - SU (leverancier)         = Karpi-GLN  (in beide richtingen onveranderd)
//   - BY (besteller)           = blijft de buyer uit de inkomende order
//   - IV (gefactureerde)       = blijft de invoicee uit de inkomende order
//   - DP (afleveradres)        = blijft de delivery party uit de inkomende order
// Het ordernummer dat we terugsturen is HET KLANT-PO-NUMMER (zelfde als inkomend).
// Onze eigen RugFlow-ordernummer kunnen we eventueel in een vrij veld kwijt.
//
// Validatie van dit format gebeurt in Transus Online → Handelspartner →
// "Orderbevestiging versturen" → Testen-tab. Pas builder aan op basis van
// de fout-/succesmelding daar.
// ============================================================================

export interface OrderbevInput {
  /** Klant-PO-nummer dat overeenkomt met inkomende order (BGM-equivalent). */
  ordernummer: string;
  /** Bevestigde leverdatum (ISO YYYY-MM-DD) of null. */
  leverdatum: string | null;
  /** Onze interne RugFlow-orderdatum (ISO YYYY-MM-DD). */
  orderdatum: string;
  /** Naam van de afnemer (max 14 chars zoals in inkomende order, getrunceerd). */
  afnemer_naam?: string | null;
  /** GLN van de gefactureerde (NAD+IV) — onveranderd uit inkomende order. */
  gln_gefactureerd: string;
  /** GLN van de besteller (NAD+BY). */
  gln_besteller: string;
  /** GLN van het afleveradres (NAD+DP). */
  gln_afleveradres: string;
  /** Onze eigen Karpi-GLN. */
  gln_leverancier: string;
  /** Test-marker. Voegt 'Y' toe op pos 441. */
  is_test?: boolean;
  regels: OrderbevRegel[];
}

export interface OrderbevRegel {
  /** Regelnummer zoals in inkomende order. */
  regelnummer: number;
  /** GTIN/EAN. */
  gtin: string;
  /** Artikelcode (SA-qualifier in EDIFACT). */
  artikelcode?: string | null;
  /** Bevestigd aantal — kan afwijken van besteld (deellevering / korting). */
  aantal: number;
  /** Klant-PO-nummer per regel (= input.ordernummer). */
  ordernummer_ref?: string | null;
}

/**
 * Bouw een uitgaande Orderbevestiging-payload (Karpi fixed-width).
 *
 * Returnt het bestand als string met CRLF-line-endings (zoals de huidige
 * Basta-output). Geschikt om als-bestand te downloaden en in Transus' Testen-tab
 * te uploaden.
 */
export function buildKarpiOrderbev(input: OrderbevInput): string {
  const headerLine = buildHeaderLine(input);
  const articleLines = input.regels.map((r) => buildArticleLine(r, input.ordernummer));

  // CRLF zoals in productie-output
  return [headerLine, ...articleLines, ''].join('\r\n');
}

function buildHeaderLine(input: OrderbevInput): string {
  const buf = new Array<string>(HEADER_LEN).fill(' ');

  // Record type
  setRange(buf, [0, 1], '0');
  // Ordernummer (positie 1-13)
  setRange(buf, HDR.ordernummer, padRight(input.ordernummer, 12));
  // Leverdatum (positie 44-52, JJJJMMDD) — leeg als null
  if (input.leverdatum) {
    setRange(buf, HDR.leverdatum, formatIsoDateToFixedWidth(input.leverdatum));
  }
  // Vlaggen (positie 76-87): 11x N (geen test)
  // Eerste positie = IsTestMessage (Y/N), rest reserved
  const flags = (input.is_test ? 'Y' : 'N') + 'NNNNNNNNNN';
  setRange(buf, HDR.vlaggen, flags);
  // Afnemer naam (positie 157-171, max 14 chars)
  if (input.afnemer_naam) {
    setRange(buf, HDR.afnemerNaam, padRight(input.afnemer_naam.slice(0, 14), 14));
  }
  // GLN gefactureerd (171-184)
  setRange(buf, HDR.glnGefactureerd, padRight(input.gln_gefactureerd, 13));
  // Orderdatum (184-192)
  setRange(buf, HDR.orderdatum, formatIsoDateToFixedWidth(input.orderdatum));
  // GLN besteller (205-218)
  setRange(buf, HDR.glnBesteller, padRight(input.gln_besteller, 13));
  // GLN afleveradres (218-231)
  setRange(buf, HDR.glnAfleveradres, padRight(input.gln_afleveradres, 13));
  // GLN gefactureerd duplicate (231-244)
  setRange(buf, HDR.glnGefactureerd2, padRight(input.gln_gefactureerd, 13));
  // GLN leverancier (257-270)
  setRange(buf, HDR.glnLeverancier, padRight(input.gln_leverancier, 13));
  // GLN leverancier duplicate (283-296)
  setRange(buf, HDR.glnLeverancier2, padRight(input.gln_leverancier, 13));
  // Ordernummer-ref (366-378)
  setRange(buf, HDR.ordernummerRef, padRight(input.ordernummer, 12));
  // Test-flag (441) — Y bij test, N anders
  setRange(buf, HDR.testFlag, input.is_test ? 'Y' : 'N');

  return buf.join('');
}

function buildArticleLine(regel: OrderbevRegel, ordernummerRef: string): string {
  const buf = new Array<string>(ARTICLE_LEN).fill(' ');

  setRange(buf, [0, 1], '1');
  // Indicator-bits (overgenomen uit inkomende voorbeelden — exacte semantiek onbekend)
  setRange(buf, [20, 21], '0');
  // GTIN (59-72)
  setRange(buf, ART.gtin, padRight(regel.gtin, 13));
  setRange(buf, [100, 101], '0');
  // Artikelcode (159-194), prefixed met '0' op pos 158
  setRange(buf, [158, 159], '0');
  if (regel.artikelcode) {
    setRange(buf, ART.artikelcode, padRight(regel.artikelcode.slice(0, 35), 35));
  }
  // Regelnummer (194-200, 6 cijfers zero-padded)
  setRange(buf, ART.regelnummer, padLeft(String(regel.regelnummer), 6, '0'));
  setRange(buf, [221, 222], '0');
  // Aantal (234-239, 5 chars decimaal "1.000")
  setRange(buf, ART.aantal, formatAantal(regel.aantal));
  // Ordernummer-ref op regel-niveau (239-251)
  setRange(buf, ART.ordernummerRef, padRight(regel.ordernummer_ref ?? ordernummerRef, 12));

  return buf.join('');
}

function setRange(buf: string[], range: readonly [number, number], value: string): void {
  for (let i = 0; i < value.length && range[0] + i < range[1]; i++) {
    buf[range[0] + i] = value[i];
  }
}

function padRight(s: string, len: number, pad = ' '): string {
  if (s.length >= len) return s.slice(0, len);
  return s + pad.repeat(len - s.length);
}

function padLeft(s: string, len: number, pad = ' '): string {
  if (s.length >= len) return s.slice(0, len);
  return pad.repeat(len - s.length) + s;
}

function formatIsoDateToFixedWidth(iso: string): string {
  // 'YYYY-MM-DD' → 'YYYYMMDD'
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '        ';
  return `${m[1]}${m[2]}${m[3]}`;
}

function formatAantal(n: number): string {
  // "1.000", "2.000" — 3 decimalen, 5 chars totaal voor enkele eenheden tot 9
  return n.toFixed(3).padStart(5, ' ').slice(0, 5);
}
