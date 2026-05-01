// Builder voor Karpi fixed-width INVOIC naar Transus "Custom ERP".
//
// Reverse-engineered uit echte BDSK factuurvoorbeelden:
// - docs/transus/voorbeelden/factuur-uit-bdsk-166794659.txt
// - Bericht-ID 168849861.zip (Karpi Group home fashion/20260429172723201)
//
// Transus vertaalt deze fixed-width input naar EDIFACT D96A INVOIC.

export interface InvoiceParty {
  name: string;
  name2?: string | null;
  gln: string;
  address: string;
  postcode: string;
  city: string;
  country: string;
  vatNumber?: string | null;
}

export interface KarpiInvoiceInput {
  invoiceDate: string;
  invoiceNumber: string;
  currencyCode?: string;
  isTestMessage?: boolean;
  documentCode?: string;
  customerShortName?: string | null;
  recipientGln?: string | null;
  orderNumberBuyer: string;
  orderDate: string;
  deliveryNoteNumber: string;
  supplierOrderNumber: string;
  vatAmount?: number;
  supplier: InvoiceParty;
  buyer: InvoiceParty;
  invoicee: InvoiceParty;
  deliveryParty: InvoiceParty;
  lines: KarpiInvoiceLineInput[];
}

export interface KarpiInvoiceLineInput {
  lineNumber: number;
  unitCode?: string;
  supplierArticleNumber: string;
  articleDescription: string;
  deliveryNoteNumber?: string | null;
  gtin: string;
  quantity: number;
  invoiceNumber?: string | null;
  netPrice: number;
  orderNumberBuyer?: string | null;
  buyerArticleNumber?: string | null;
  lineAmount: number;
  taxableAmount?: number | null;
  vatAmount?: number | null;
  packageQuantity?: number | null;
  weightKg?: number | null;
  vatPercentage?: number | null;
}

const HEADER_LEN = 1107;
const ARTICLE_LEN = 312;

const HDR = {
  recordType: [0, 1] as const,
  creditNoteFlag: [1, 2] as const,
  invoiceDate1: [2, 10] as const,
  deliveryPartyGln1: [10, 23] as const,
  currencyCode: [23, 26] as const,
  messageCode: [26, 29] as const,
  testFlag: [29, 30] as const,
  invoiceDate2: [30, 38] as const,
  invoiceNumber: [38, 46] as const,
  invoiceeGln: [50, 63] as const,
  documentCode: [63, 66] as const,
  customerShortName: [66, 88] as const,
  vatAmount: [89, 97] as const,
  recipientGln: [97, 110] as const,
  orderNumberBuyer: [118, 153] as const,
  buyerGln: [223, 236] as const,
  supplierGln1: [236, 249] as const,
  buyerVatNumber: [288, 299] as const,
  supplierGln2: [303, 316] as const,
  deliveryNoteNumber1: [316, 323] as const,
  deliveryNoteDate: [328, 336] as const,
  deliveryNoteNumber2: [336, 343] as const,
  supplierOrderNumber: [456, 464] as const,
  orderDate: [491, 499] as const,
  supplierName: [504, 539] as const,
  supplierAddress: [539, 574] as const,
  supplierPostcode: [574, 584] as const,
  supplierCity: [584, 619] as const,
  supplierCountry: [619, 621] as const,
  buyerName: [621, 656] as const,
  buyerGln2: [656, 669] as const,
  buyerAddress: [691, 731] as const,
  buyerPostcode: [731, 741] as const,
  buyerCity: [741, 781] as const,
  buyerCountry: [781, 783] as const,
  invoiceeName: [783, 818] as const,
  invoiceeName2: [818, 853] as const,
  invoiceeAddress: [853, 893] as const,
  invoiceePostcode: [893, 903] as const,
  invoiceeCity: [903, 943] as const,
  invoiceeCountry: [943, 945] as const,
  deliveryName: [945, 980] as const,
  deliveryName2: [980, 1015] as const,
  deliveryAddress: [1015, 1055] as const,
  deliveryPostcode: [1055, 1065] as const,
  deliveryCity: [1065, 1105] as const,
  deliveryCountry: [1105, 1107] as const,
};

const ART = {
  recordType: [0, 1] as const,
  lineNumber: [1, 6] as const,
  unitCode: [6, 9] as const,
  supplierArticleNumber: [9, 19] as const,
  articleDescription: [19, 89] as const,
  deliveryNoteNumber: [89, 96] as const,
  gtin: [124, 137] as const,
  quantity: [138, 147] as const,
  invoiceNumber: [159, 167] as const,
  netPrice: [194, 205] as const,
  orderNumberBuyer: [205, 240] as const,
  buyerArticleNumber: [240, 251] as const,
  lineAmount: [260, 270] as const,
  taxableAmount: [270, 280] as const,
  vatAmount: [280, 290] as const,
  packageQuantity: [290, 296] as const,
  weightKg: [296, 305] as const,
  vatPercentage: [305, 309] as const,
  weightUnit: [309, 312] as const,
};

export function buildKarpiInvoiceFixedWidth(input: KarpiInvoiceInput): string {
  validateInvoiceInput(input);
  const header = buildHeaderLine(input);
  const lines = input.lines.map((line) => buildArticleLine(line, input));
  return [header, ...lines, ''].join('\r\n');
}

function buildHeaderLine(input: KarpiInvoiceInput): string {
  const buf = new Array<string>(HEADER_LEN).fill(' ');
  const invoiceDate = formatDateYmd(input.invoiceDate);
  const invoiceNumber = formatDocumentNumber(input.invoiceNumber, 8);
  const deliveryNoteNumber = formatDocumentNumber(input.deliveryNoteNumber, 7);
  const supplierOrderNumber = formatDocumentNumber(input.supplierOrderNumber, 8);

  setRange(buf, HDR.recordType, '0');
  setRange(buf, HDR.creditNoteFlag, 'N');
  setRange(buf, HDR.invoiceDate1, invoiceDate);
  setRange(buf, HDR.deliveryPartyGln1, fixed(input.deliveryParty.gln, 13));
  setRange(buf, HDR.currencyCode, fixed(input.currencyCode ?? 'EUR', 3));
  setRange(buf, HDR.messageCode, '045');
  setRange(buf, HDR.testFlag, input.isTestMessage ? 'Y' : 'N');
  setRange(buf, HDR.invoiceDate2, invoiceDate);
  setRange(buf, HDR.invoiceNumber, invoiceNumber);
  setRange(buf, HDR.invoiceeGln, fixed(input.invoicee.gln, 13));
  setRange(buf, HDR.documentCode, fixed(input.documentCode ?? '380', 3));
  setRange(buf, HDR.customerShortName, fixed(input.customerShortName ?? '', 22));
  setRange(buf, HDR.vatAmount, formatAmount(input.vatAmount ?? 0, 8));
  setRange(buf, HDR.recipientGln, fixed(input.recipientGln ?? input.invoicee.gln, 13));
  setRange(buf, HDR.orderNumberBuyer, fixed(input.orderNumberBuyer, 35));
  setRange(buf, HDR.buyerGln, fixed(input.buyer.gln, 13));
  setRange(buf, HDR.supplierGln1, fixed(input.supplier.gln, 13));
  setRange(buf, HDR.buyerVatNumber, fixed(input.invoicee.vatNumber ?? input.buyer.vatNumber ?? '', 11));
  setRange(buf, HDR.supplierGln2, fixed(input.supplier.gln, 13));
  setRange(buf, HDR.deliveryNoteNumber1, deliveryNoteNumber);
  setRange(buf, HDR.deliveryNoteDate, invoiceDate);
  setRange(buf, HDR.deliveryNoteNumber2, deliveryNoteNumber);
  setRange(buf, HDR.supplierOrderNumber, supplierOrderNumber);
  setRange(buf, HDR.orderDate, formatDateYmd(input.orderDate));

  writeSupplier(buf, input.supplier);
  writeBuyer(buf, input.buyer);
  writeInvoicee(buf, input.invoicee);
  writeDeliveryParty(buf, input.deliveryParty);

  return buf.join('');
}

function buildArticleLine(line: KarpiInvoiceLineInput, input: KarpiInvoiceInput): string {
  const buf = new Array<string>(ARTICLE_LEN).fill(' ');
  const deliveryNoteNumber = formatDocumentNumber(line.deliveryNoteNumber ?? input.deliveryNoteNumber, 7);
  const invoiceNumber = formatDocumentNumber(line.invoiceNumber ?? input.invoiceNumber, 8);
  const orderNumberBuyer = line.orderNumberBuyer ?? input.orderNumberBuyer;
  const packageQuantity = line.packageQuantity ?? line.quantity;
  const vatPercentage = line.vatPercentage ?? 0;

  setRange(buf, ART.recordType, '2');
  setRange(buf, ART.lineNumber, padLeft(String(line.lineNumber), 5, '0'));
  setRange(buf, ART.unitCode, fixed(line.unitCode ?? 'PCE', 3));
  setRange(buf, ART.supplierArticleNumber, formatSupplierArticleNumber(line.supplierArticleNumber));
  setRange(buf, ART.articleDescription, fixed(line.articleDescription, 70));
  setRange(buf, ART.deliveryNoteNumber, deliveryNoteNumber);
  setRange(buf, ART.gtin, fixed(line.gtin, 13));
  setRange(buf, ART.quantity, formatInteger(line.quantity, 9));
  setRange(buf, ART.invoiceNumber, invoiceNumber);
  setRange(buf, ART.netPrice, formatAmount(line.netPrice, 11));
  setRange(buf, ART.orderNumberBuyer, fixed(orderNumberBuyer, 35));
  setRange(buf, ART.buyerArticleNumber, fixed(line.buyerArticleNumber ?? '', 11));
  setRange(buf, ART.lineAmount, formatAmount(line.lineAmount, 10));
  setRange(buf, ART.taxableAmount, formatAmount(line.taxableAmount ?? line.lineAmount, 10));

  if ((line.vatAmount ?? 0) !== 0) {
    setRange(buf, ART.vatAmount, formatAmount(line.vatAmount ?? 0, 10));
  }

  setRange(buf, ART.packageQuantity, formatInteger(packageQuantity, 6));
  setRange(buf, ART.weightKg, formatWeight(line.weightKg ?? 0));
  setRange(buf, ART.vatPercentage, formatVatPercentage(vatPercentage));
  setRange(buf, ART.weightUnit, 'KGM');

  return buf.join('');
}

function writeSupplier(buf: string[], party: InvoiceParty): void {
  setRange(buf, HDR.supplierName, fixed(party.name, 35));
  setRange(buf, HDR.supplierAddress, fixed(party.address, 35));
  setRange(buf, HDR.supplierPostcode, fixed(party.postcode, 10));
  setRange(buf, HDR.supplierCity, fixed(party.city, 35));
  setRange(buf, HDR.supplierCountry, fixed(party.country, 2));
}

function writeBuyer(buf: string[], party: InvoiceParty): void {
  setRange(buf, HDR.buyerName, fixed(party.name, 35));
  setRange(buf, HDR.buyerGln2, fixed(party.gln, 13));
  setRange(buf, HDR.buyerAddress, fixed(party.address, 40));
  setRange(buf, HDR.buyerPostcode, fixed(party.postcode, 10));
  setRange(buf, HDR.buyerCity, fixed(party.city, 40));
  setRange(buf, HDR.buyerCountry, fixed(party.country, 2));
}

function writeInvoicee(buf: string[], party: InvoiceParty): void {
  setRange(buf, HDR.invoiceeName, fixed(party.name, 35));
  setRange(buf, HDR.invoiceeName2, fixed(party.name2 ?? '', 35));
  setRange(buf, HDR.invoiceeAddress, fixed(party.address, 40));
  setRange(buf, HDR.invoiceePostcode, fixed(party.postcode, 10));
  setRange(buf, HDR.invoiceeCity, fixed(party.city, 40));
  setRange(buf, HDR.invoiceeCountry, fixed(party.country, 2));
}

function writeDeliveryParty(buf: string[], party: InvoiceParty): void {
  setRange(buf, HDR.deliveryName, fixed(party.name, 35));
  setRange(buf, HDR.deliveryName2, fixed(party.name2 ?? '', 35));
  setRange(buf, HDR.deliveryAddress, fixed(party.address, 40));
  setRange(buf, HDR.deliveryPostcode, fixed(party.postcode, 10));
  setRange(buf, HDR.deliveryCity, fixed(party.city, 40));
  setRange(buf, HDR.deliveryCountry, fixed(party.country, 2));
}

function validateInvoiceInput(input: KarpiInvoiceInput): void {
  const missing: string[] = [];
  if (!input.invoiceDate) missing.push('invoiceDate');
  if (!input.invoiceNumber) missing.push('invoiceNumber');
  if (!input.orderNumberBuyer) missing.push('orderNumberBuyer');
  if (!input.orderDate) missing.push('orderDate');
  if (!input.deliveryNoteNumber) missing.push('deliveryNoteNumber');
  if (!input.supplierOrderNumber) missing.push('supplierOrderNumber');
  if (input.lines.length === 0) missing.push('lines');

  for (const [label, party] of [
    ['supplier', input.supplier],
    ['buyer', input.buyer],
    ['invoicee', input.invoicee],
    ['deliveryParty', input.deliveryParty],
  ] as const) {
    for (const field of ['name', 'gln', 'address', 'postcode', 'city', 'country'] as const) {
      if (!party[field]) missing.push(`${label}.${field}`);
    }
  }

  input.lines.forEach((line, i) => {
    if (!line.supplierArticleNumber) missing.push(`lines[${i}].supplierArticleNumber`);
    if (!line.articleDescription) missing.push(`lines[${i}].articleDescription`);
    if (!line.gtin) missing.push(`lines[${i}].gtin`);
  });

  if (missing.length > 0) {
    throw new Error(`Karpi INVOIC fixed-width: verplichte velden ontbreken: ${missing.join(', ')}`);
  }
}

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
  throw new Error(`Invalid date for Karpi INVOIC fixed-width: "${value}"`);
}

function formatDocumentNumber(value: string, len: number): string {
  const digits = value.replace(/\D/g, '');
  const source = digits || cleanText(value);
  return padLeft(source.slice(-len), len, '0');
}

function formatSupplierArticleNumber(value: string): string {
  const clean = cleanText(value);
  if (/^\d+$/.test(clean)) return padLeft(clean, 10, '0');
  return fixed(clean, 10);
}

function formatInteger(value: number, len: number): string {
  return padLeft(String(Math.round(value)), len, '0');
}

function formatAmount(value: number, len: number): string {
  return padLeft(value.toFixed(2), len, '0');
}

function formatWeight(value: number): string {
  return padLeft(value.toFixed(2), 9, '0');
}

function formatVatPercentage(value: number): string {
  return value.toFixed(2).slice(0, 4).padStart(4, '0');
}
