// Pure mapper: Karpi factuur-data → KarpiInvoiceInput voor de fixed-width
// INVOIC-builder. Geen DB- of netwerk-toegang — zuiver transformatie zodat het
// los te unit-testen is. De edge function `bouw-factuur-edi` haalt de data op,
// vult `FactuurEdiData` en geeft dat hieraan door.
//
// Scope V1 (zie docs/superpowers/plans/2026-06-03-edi-factuur-uitgaand.md):
// alleen per-order facturen; partijen komen van de order-snapshot (heeft GLN's).

import type {
  KarpiInvoiceInput,
  KarpiInvoiceLineInput,
  InvoiceParty,
} from './karpi-invoice-fixed-width.ts';

/** Eén partij-snapshot zoals die op `orders` staat (bes_/fact_/afl_ + gln). */
export interface FactuurEdiPartij {
  naam: string | null;
  adres: string | null;
  postcode: string | null;
  plaats: string | null;
  land: string | null;
  gln: string | null;
}

export interface FactuurEdiRegel {
  regelnummer: number;
  artikelnr: string | null;
  omschrijving: string | null;
  aantal: number;
  prijs: number;
  bedrag: number;
  btw_percentage: number;
  /** Opgeloste GTIN uit producten.ean_code; null als niet gevonden. */
  gtin: string | null;
}

export interface FactuurEdiData {
  factuur: {
    factuur_nr: string;
    factuurdatum: string; // ISO (YYYY-MM-DD)
    btw_bedrag: number;
  };
  order: {
    order_nr: string;
    orderdatum: string; // ISO
    klant_referentie: string | null;
    btw_nummer: string | null;
    besteller: FactuurEdiPartij; // NAD+BY
    factuuradres: FactuurEdiPartij; // NAD+IV (invoicee)
    afleveradres: FactuurEdiPartij; // NAD+DP
  };
  supplier: {
    name: string;
    gln: string;
    address: string;
    postcode: string;
    city: string;
    country: string;
    vatNumber?: string | null;
  };
  debiteur: {
    naam: string;
    btw_nummer: string | null;
    /** TRUE → BTW-verlegd intracom → 0% op alle regels. */
    btw_verlegd_intracom: boolean;
  };
  /** Leverbon-/pakbonnummer; verplicht in de builder. */
  deliveryNoteNumber: string;
  isTestMessage: boolean;
  regels: FactuurEdiRegel[];
}

/**
 * Map factuur-data naar de input van buildKarpiInvoiceFixedWidth.
 * Gooit een Error met actuele context als verplichte data ontbreekt (bv. een
 * regel zonder GTIN) — beter falen dan een kapot INVOIC versturen.
 */
export function mapFactuurNaarInvoiceInput(data: FactuurEdiData): KarpiInvoiceInput {
  const verlegd = data.debiteur.btw_verlegd_intracom;

  const lines: KarpiInvoiceLineInput[] = [];
  const missingGtin: string[] = [];

  for (const r of data.regels) {
    if (!r.gtin) {
      missingGtin.push(r.artikelnr ?? `regel ${r.regelnummer}`);
      continue;
    }
    const vatPercentage = verlegd ? 0 : r.btw_percentage;
    const vatAmount = verlegd ? 0 : round2((r.bedrag * vatPercentage) / 100);
    lines.push({
      lineNumber: r.regelnummer,
      supplierArticleNumber: r.artikelnr ?? '',
      articleDescription: r.omschrijving ?? r.artikelnr ?? '',
      gtin: r.gtin,
      quantity: r.aantal,
      netPrice: r.prijs,
      lineAmount: r.bedrag,
      taxableAmount: r.bedrag,
      vatAmount,
      vatPercentage,
    });
  }

  if (missingGtin.length > 0) {
    throw new Error(
      `Factuur ${data.factuur.factuur_nr}: ${missingGtin.length} regel(s) zonder GTIN/EAN ` +
        `(${missingGtin.join(', ')}). Vul producten.ean_code aan voordat de factuur via EDI gaat.`,
    );
  }
  if (lines.length === 0) {
    throw new Error(`Factuur ${data.factuur.factuur_nr}: geen factureerbare regels met GTIN.`);
  }

  const invoicee = partijNaarInvoiceParty(data.order.factuuradres, {
    vatNumber: data.order.btw_nummer ?? data.debiteur.btw_nummer,
  });
  // bes_* is NULL voor niet-EDI orders waar besteller = factuuradres → fallback.
  const buyer = data.order.besteller.naam
    ? partijNaarInvoiceParty(data.order.besteller)
    : invoicee;
  const deliveryParty = partijNaarInvoiceParty(data.order.afleveradres);

  return {
    invoiceDate: data.factuur.factuurdatum,
    invoiceNumber: data.factuur.factuur_nr,
    isTestMessage: data.isTestMessage,
    customerShortName: data.debiteur.naam,
    recipientGln: data.order.factuuradres.gln ?? invoicee.gln,
    orderNumberBuyer: data.order.klant_referentie ?? data.order.order_nr,
    orderDate: data.order.orderdatum,
    deliveryNoteNumber: data.deliveryNoteNumber,
    supplierOrderNumber: data.order.order_nr,
    vatAmount: data.factuur.btw_bedrag,
    supplier: {
      ...data.supplier,
      country: normaliseerLand(data.supplier.country),
    },
    buyer,
    invoicee,
    deliveryParty,
    lines,
  };
}

function partijNaarInvoiceParty(
  p: FactuurEdiPartij,
  extra: { vatNumber?: string | null } = {},
): InvoiceParty {
  return {
    name: p.naam ?? '',
    gln: p.gln ?? '',
    address: p.adres ?? '',
    postcode: p.postcode ?? '',
    city: p.plaats ?? '',
    country: normaliseerLand(p.land),
    vatNumber: extra.vatNumber ?? null,
  };
}

/** ISO 3166 alpha-2. Snapshots uit EDIFACT zijn vaak al 'DE'/'NL'; bedrijfsgegevens
 *  kan 'Nederland' zijn. Map het bekende, anders eerste 2 letters uppercase. */
function normaliseerLand(land: string | null): string {
  if (!land) return '';
  const clean = land.trim();
  if (clean.length === 2) return clean.toUpperCase();
  const map: Record<string, string> = {
    nederland: 'NL',
    netherlands: 'NL',
    holland: 'NL',
    duitsland: 'DE',
    deutschland: 'DE',
    germany: 'DE',
    belgie: 'BE',
    belgië: 'BE',
    belgium: 'BE',
    luxemburg: 'LU',
    luxembourg: 'LU',
    oostenrijk: 'AT',
    zwitserland: 'CH',
  };
  return map[clean.toLowerCase()] ?? clean.slice(0, 2).toUpperCase();
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
