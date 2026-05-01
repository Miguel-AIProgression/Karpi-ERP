// TransusXML-builder voor uitgaande orderbevestiging (`<ORDERRESPONSES>`-format).
//
// Reverse-engineered uit het BDSK-voorbeeld op 2026-04-30:
//   docs/transus/voorbeelden/orderbev-uit-bdsk-168911805.xml
//
// Dit format wordt door Transus geaccepteerd als input voor proces "Orderbevestiging
// versturen" en daarna door Transus zelf vertaald naar EDIFACT D96A `ORDRSP` voor
// de partner. Voor BDSK is dit het bewezen werkende format. Voor andere partners
// onbekend — vandaar dat `edi_handelspartner_config.orderbev_format` per debiteur
// instelbaar is.
//
// Format-eigenaardigheden uit het voorbeeld:
//   - XML-declaratie: `<?xml version="1.0"?>` zonder encoding-attribuut
//   - Geen XML-namespace
//   - Element-content op aparte regels (geen indentatie)
//   - String-velden right-padded met spaces (bv. OrderNumberBuyer 35 chars)
//   - Datums als YYYYMMDD (geen separators)
//   - Decimal punt voor prijs (29.73), 2 decimalen
//   - Action-codes ACC/CHA/REJ op zowel header als per regel

// ============================================================================
// Types
// ============================================================================

export type OrderbevAction = 'ACC' | 'CHA' | 'REJ';

export interface OrderbevXmlInput {
  // ── Header ─────────────────────────────────────────────────────────────
  /** Karpi GLN (NAD+SU). */
  senderGln: string;
  /** Partner factuur-GLN (NAD+IV). */
  recipientGln: string;
  isTestMessage: boolean;
  /**
   * `<OrderResponseNumber>` — bij voorkeur Karpi-ordernr + zero-padded sequentie.
   * Voorbeeld: ordernr `26554360` + seq `01` → `265543600001`.
   */
  orderResponseNumber: string;
  /** YYYY-MM-DD; wordt naar YYYYMMDD geconverteerd in de XML. */
  orderResponseDate: string;
  action: OrderbevAction;
  /** Klant-PO uit inkomende order (`OrderNumberBuyer`). */
  orderNumberBuyer: string;
  /** Karpi-ordernummer (`OrderNumberSupplier`). */
  orderNumberSupplier: string;
  /** YYYY-MM-DD. */
  orderDate: string;
  /** YYYY-MM-DD. */
  earliestDeliveryDate: string;
  /** YYYY-MM-DD. */
  latestDeliveryDate: string;
  currencyCode: string;
  /** NAD+BY. */
  buyerGln: string;
  /** NAD+SU = Karpi (zelfde als senderGln). */
  supplierGln: string;
  /** NAD+IV (zelfde als recipientGln). */
  invoiceeGln: string;
  /** NAD+DP. */
  deliveryPartyGln: string;

  // ── Articles ────────────────────────────────────────────────────────────
  articles: OrderbevXmlArticle[];
}

export interface OrderbevXmlArticle {
  /** Lijnnummer als string, gepad naar 5 cijfers (bv. "00001"). */
  lineNumber: string;
  articleDescription: string;
  /** Karpi-artikelcode. */
  articleCodeSupplier: string;
  /** GTIN/EAN, 13-14 cijfers. */
  gtin: string;
  /** Inkoopprijs (zelfde als netto in voorbeeld). */
  purchasePrice: number;
  articleNetPrice: number;
  /** BTW-percentage, 0 voor intracommunautair. */
  vatPercentage: number;
  action: OrderbevAction;
  orderedQuantity: number;
  despatchedQuantity: number;
  /** YYYY-MM-DD, wordt geconverteerd naar YYYYMMDD. */
  deliveryDate: string;
}

// ============================================================================
// Builder
// ============================================================================

const HEADER_PAD_ORDERNUMBER_BUYER = 35; // uit voorbeeld: "8MRE0" + 30 spaces

/**
 * Bouw een TransusXML orderbevestiging-string die door Transus' "Orderbevestiging
 * versturen"-proces wordt geaccepteerd.
 *
 * Output is byte-identiek aan productie-voorbeelden modulo OrderResponseNumber/Date
 * en de regel-specifieke velden (artikel, prijs, aantal).
 */
export function buildOrderbevTransusXml(input: OrderbevXmlInput): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0"?>');
  lines.push('<ORDERRESPONSES>');
  lines.push('<ORDERRESPONSE>');

  // ── Header ─────────────────────────────────────────────────────────────
  lines.push('<HEADER>');
  lines.push(`<MessageFormat>TRANSUSXML</MessageFormat>`);
  lines.push(`<SenderGLN>${escapeXml(input.senderGln)}</SenderGLN>`);
  lines.push(`<RecipientGLN>${escapeXml(input.recipientGln)}</RecipientGLN>`);
  lines.push(`<IsTestMessage>${input.isTestMessage ? 'Y' : 'N'}</IsTestMessage>`);
  lines.push(`<OrderResponseNumber>${escapeXml(input.orderResponseNumber)}</OrderResponseNumber>`);
  lines.push(`<OrderResponseDate>${formatDateYmd(input.orderResponseDate)}</OrderResponseDate>`);
  lines.push(`<Action>${input.action}</Action>`);
  lines.push(
    `<OrderNumberBuyer>${escapeXml(padRight(input.orderNumberBuyer, HEADER_PAD_ORDERNUMBER_BUYER))}</OrderNumberBuyer>`,
  );
  lines.push(`<OrderNumberSupplier>${escapeXml(input.orderNumberSupplier)}</OrderNumberSupplier>`);
  lines.push(`<OrderDate>${formatDateYmd(input.orderDate)}</OrderDate>`);
  lines.push(
    `<EarliestDeliveryDate>${formatDateYmd(input.earliestDeliveryDate)}</EarliestDeliveryDate>`,
  );
  lines.push(`<LatestDeliveryDate>${formatDateYmd(input.latestDeliveryDate)}</LatestDeliveryDate>`);
  lines.push(`<CurrencyCode>${escapeXml(input.currencyCode)}</CurrencyCode>`);
  lines.push(`<BuyerGLN>${escapeXml(input.buyerGln)}</BuyerGLN>`);
  lines.push(`<SupplierGLN>${escapeXml(input.supplierGln)}</SupplierGLN>`);
  lines.push(`<InvoiceeGLN>${escapeXml(input.invoiceeGln)}</InvoiceeGLN>`);
  lines.push(`<DeliveryPartyGLN>${escapeXml(input.deliveryPartyGln)}</DeliveryPartyGLN>`);
  lines.push('</HEADER>');

  // ── Articles ────────────────────────────────────────────────────────────
  for (const a of input.articles) {
    lines.push('<ARTICLE>');
    lines.push(`<LineNumber>${padLeft(a.lineNumber, 5, '0')}</LineNumber>`);
    lines.push(`<ArticleDescription>${escapeXml(a.articleDescription)}</ArticleDescription>`);
    lines.push(`<ArticleCodeSupplier>${escapeXml(a.articleCodeSupplier)}</ArticleCodeSupplier>`);
    lines.push(`<GTIN>${escapeXml(a.gtin)}</GTIN>`);
    lines.push(`<PurchasePrice>${formatDecimal(a.purchasePrice)}</PurchasePrice>`);
    lines.push(`<ArticleNetPrice>${formatDecimal(a.articleNetPrice)}</ArticleNetPrice>`);
    lines.push(`<VATPercentage>${a.vatPercentage}</VATPercentage>`);
    lines.push(`<Action>${a.action}</Action>`);
    lines.push(`<OrderedQuantity>${a.orderedQuantity}</OrderedQuantity>`);
    lines.push(`<DespatchedQuantity>${a.despatchedQuantity}</DespatchedQuantity>`);
    lines.push(`<DeliveryDate>${formatDateYmd(a.deliveryDate)}</DeliveryDate>`);
    lines.push('</ARTICLE>');
  }

  lines.push('</ORDERRESPONSE>');
  lines.push('</ORDERRESPONSES>');

  return lines.join('\n') + '\n';
}

/**
 * Bouw een `<OrderResponseNumber>` op basis van Karpi-ordernr + sequentie.
 * Eerste bevestiging seq=1 → `26554360` + `0001` → `265543600001`.
 *
 * Suffix is 4-digit zero-padded conform BDSK-voorbeeld (orderbev-uit-bdsk-168911805.xml).
 */
export function buildOrderResponseNumber(orderNumberSupplier: string, seq: number): string {
  if (seq < 1 || seq > 9999) {
    throw new Error(`OrderResponseNumber sequence must be 1-9999, got ${seq}`);
  }
  return `${orderNumberSupplier}${seq.toString().padStart(4, '0')}`;
}

// ============================================================================
// Helpers
// ============================================================================

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Converteert YYYY-MM-DD → YYYYMMDD; tolerant voor input dat al YYYYMMDD is. */
function formatDateYmd(iso: string): string {
  if (/^\d{8}$/.test(iso)) return iso;
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10).replace(/-/g, '');
  throw new Error(`Invalid date format for TransusXML: "${iso}" (expected YYYY-MM-DD or YYYYMMDD)`);
}

function formatDecimal(n: number): string {
  return n.toFixed(2);
}

function padRight(s: string, len: number): string {
  if (s.length >= len) return s;
  return s + ' '.repeat(len - s.length);
}

function padLeft(s: string, len: number, char = ' '): string {
  if (s.length >= len) return s;
  return char.repeat(len - s.length) + s;
}
