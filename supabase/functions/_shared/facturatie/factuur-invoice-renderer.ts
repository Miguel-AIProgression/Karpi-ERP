// EDI-INVOIC-renderer: FactuurDocument → KarpiInvoiceInput.
//
// Vervangt de twee divergerende factuur→INVOIC-transforms (factuur-verzenden
// buildEdiFactuurInput + bouw-factuur-edi mapFactuurNaarInvoiceInput) door één
// gedeelde renderer op het canonieke Factuurdocument. De regel-inhoud
// (artikeltekst/-nummer/GTIN/gewicht) komt uit de al-opgeloste Artikelpresentatie
// in doc.regels; alleen de EDI-specifieke partij-/GLN-opbouw leeft hier.
//
// Gedragsneutraal t.o.v. de huidige AUTOMATISCHE buildEdiFactuurInput (ADR-0036
// slice 3); het handmatige pad trekt bewust op naar dit rijkere contract.
// Pure functie (geen DB) — de caller levert de partij-/order-context.

import { normalizeCountry } from '../adres-split.ts'
import { externReferentie } from '../referentie.ts'
import type {
  InvoiceParty,
  KarpiInvoiceInput,
  KarpiInvoiceLineInput,
} from '../transus-formats/karpi-invoice-fixed-width.ts'
import type { FactuurDocument } from './factuur-document.ts'

/** Order-partijsnapshot (orders-rij) zoals de EDI-renderer hem leest. */
export interface FactuurInvoiceOrder {
  id: number
  order_nr: string
  oud_order_nr: number | string | null
  orderdatum: string | null
  klant_referentie: string | null
  bes_naam: string | null
  bes_adres: string | null
  bes_postcode: string | null
  bes_plaats: string | null
  bes_land: string | null
  afl_naam: string | null
  afl_naam_2: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_plaats: string | null
  afl_land: string | null
  factuuradres_gln: string | null
  besteller_gln: string | null
  afleveradres_gln: string | null
}

export interface FactuurInvoiceBedrijf {
  bedrijfsnaam?: string | null
  gln_eigen?: string | null
  adres?: string | null
  postcode?: string | null
  plaats?: string | null
  land?: string | null
  btw_nummer?: string | null
}

/** Debiteur-velden voor de invoicee-fallback (factuuradres ontbreekt op de factuur). */
export interface FactuurInvoiceDebiteur {
  naam: string | null
  btw_nummer: string | null
  fact_naam: string | null
  fact_adres: string | null
  fact_postcode: string | null
  fact_plaats: string | null
  /** Laatste-redmiddel-fallback als zowel de factuur-snapshot als fact_* leeg zijn. */
  adres?: string | null
  postcode?: string | null
  plaats?: string | null
  land: string | null
  gln_bedrijf: string | null
}

export interface FactuurInvoiceContext {
  bedrijf: FactuurInvoiceBedrijf
  debiteur: FactuurInvoiceDebiteur
  orders: FactuurInvoiceOrder[]
  /** Leverbon-/pakbonnummer (zending_nr of factuur_nr). */
  deliveryNoteNumber: string
}

function firstNonEmpty(...values: Array<string | number | null | undefined>): string | null {
  for (const value of values) {
    if (value == null) continue
    const s = String(value).trim()
    if (s !== '') return s
  }
  return null
}

function buildSupplierParty(b: FactuurInvoiceBedrijf): InvoiceParty {
  return {
    name: b.bedrijfsnaam ?? 'KARPI GROUP HOME FASHION B.V.',
    gln: b.gln_eigen ?? '8715954999998',
    address: b.adres ?? 'TWEEDE BROEKDIJK 10',
    postcode: b.postcode ?? '7122 LB',
    city: b.plaats ?? 'AALTEN',
    country: normalizeCountry(b.land || 'NL'),
    vatNumber: b.btw_nummer ?? null,
  }
}

function buildInvoiceeParty(
  header: FactuurDocument['header'],
  debiteur: FactuurInvoiceDebiteur,
  gln: string,
): InvoiceParty {
  return {
    name: firstNonEmpty(header.fact_naam, debiteur.fact_naam, debiteur.naam, 'Onbekend')!,
    gln,
    address: firstNonEmpty(header.fact_adres, debiteur.fact_adres, debiteur.adres, '-')!,
    postcode: firstNonEmpty(header.fact_postcode, debiteur.fact_postcode, debiteur.postcode, '-')!,
    city: firstNonEmpty(header.fact_plaats, debiteur.fact_plaats, debiteur.plaats, '-')!,
    country: normalizeCountry(firstNonEmpty(header.fact_land, debiteur.land) || 'NL'),
    vatNumber: firstNonEmpty(header.btw_nummer_afnemer, debiteur.btw_nummer),
  }
}

function buildDeliveryParty(order: FactuurInvoiceOrder, fallback: InvoiceParty, gln: string): InvoiceParty {
  return {
    name: firstNonEmpty(order.afl_naam, fallback.name)!,
    name2: order.afl_naam_2,
    gln,
    address: firstNonEmpty(order.afl_adres, fallback.address)!,
    postcode: firstNonEmpty(order.afl_postcode, fallback.postcode)!,
    city: firstNonEmpty(order.afl_plaats, fallback.city)!,
    country: normalizeCountry(firstNonEmpty(order.afl_land, fallback.country) || fallback.country),
    vatNumber: fallback.vatNumber,
  }
}

function buildBuyerParty(
  order: FactuurInvoiceOrder,
  invoicee: InvoiceParty,
  deliveryParty: InvoiceParty,
  gln: string,
): InvoiceParty {
  const addressSource = gln === deliveryParty.gln ? deliveryParty : invoicee
  return {
    name: firstNonEmpty(order.bes_naam, addressSource.name)!,
    gln,
    address: firstNonEmpty(order.bes_adres, addressSource.address)!,
    postcode: firstNonEmpty(order.bes_postcode, addressSource.postcode)!,
    city: firstNonEmpty(order.bes_plaats, addressSource.city)!,
    country: normalizeCountry(firstNonEmpty(order.bes_land, addressSource.country) || addressSource.country),
    vatNumber: invoicee.vatNumber,
  }
}

/**
 * Render het Factuurdocument naar de INVOIC-builder-input.
 * Gooit bij ontbrekende GLN's (zoals de huidige buildEdiFactuurInput) — beter
 * falen dan een kapot INVOIC versturen.
 */
export function naarInvoiceInput(doc: FactuurDocument, ctx: FactuurInvoiceContext): KarpiInvoiceInput {
  const { header } = doc
  const firstOrder = ctx.orders[0]
  if (!firstOrder) {
    throw new Error(`Factuur ${header.factuur_nr}: geen gekoppelde orders voor EDI INVOIC`)
  }

  const invoiceeGln = firstNonEmpty(firstOrder.factuuradres_gln, ctx.debiteur.gln_bedrijf)
  const buyerGln = firstNonEmpty(firstOrder.besteller_gln, firstOrder.afleveradres_gln, invoiceeGln)
  const deliveryGln = firstNonEmpty(firstOrder.afleveradres_gln, buyerGln)
  if (!invoiceeGln || !buyerGln || !deliveryGln) {
    throw new Error(
      `Factuur ${header.factuur_nr}: GLN ontbreekt (IV=${invoiceeGln ?? '-'}, BY=${buyerGln ?? '-'}, DP=${deliveryGln ?? '-'})`,
    )
  }

  const supplier = buildSupplierParty(ctx.bedrijf)
  const invoicee = buildInvoiceeParty(header, ctx.debiteur, invoiceeGln)
  const deliveryParty = buildDeliveryParty(firstOrder, invoicee, deliveryGln)
  const buyer = buildBuyerParty(firstOrder, invoicee, deliveryParty, buyerGln)

  const ordersById = new Map(ctx.orders.map((o) => [o.id, o]))
  const orderNumberBuyer = firstNonEmpty(
    doc.regels.find((r) => r.uw_referentie)?.uw_referentie,
    externReferentie(firstOrder.klant_referentie),
    header.factuur_nr,
  )!
  const supplierOrderNumber = firstNonEmpty(
    firstOrder.oud_order_nr == null ? null : String(firstOrder.oud_order_nr),
    firstOrder.order_nr,
    header.factuur_nr,
  )!
  const { deliveryNoteNumber } = ctx

  const lines: KarpiInvoiceLineInput[] = doc.regels.map((r) => {
    const regelOrder = ordersById.get(r.order_id) ?? firstOrder
    return {
      lineNumber: r.regelnummer,
      supplierArticleNumber: r.artikelnr,
      articleDescription: r.presentatie.artikel_tekst,
      deliveryNoteNumber,
      gtin: r.presentatie.gtin,
      quantity: r.aantal,
      invoiceNumber: header.factuur_nr,
      netPrice: r.prijs,
      orderNumberBuyer: firstNonEmpty(r.uw_referentie, externReferentie(regelOrder.klant_referentie), orderNumberBuyer),
      buyerArticleNumber: r.presentatie.klant_artikel,
      lineAmount: r.bedrag,
      taxableAmount: r.bedrag,
      vatAmount: Math.round(r.bedrag * r.btw_percentage) / 100,
      packageQuantity: r.aantal,
      weightKg: r.presentatie.gewicht_kg,
      vatPercentage: r.btw_percentage,
    }
  })

  return {
    invoiceDate: header.factuurdatum,
    invoiceNumber: header.factuur_nr,
    customerShortName: ctx.debiteur.naam ?? null,
    recipientGln: invoiceeGln,
    orderNumberBuyer,
    orderDate: firstOrder.orderdatum ?? header.factuurdatum,
    deliveryNoteNumber,
    supplierOrderNumber,
    vatAmount: header.btw_bedrag,
    isTestMessage: doc.isTestMessage,
    supplier,
    buyer,
    invoicee,
    deliveryParty,
    lines,
  }
}
