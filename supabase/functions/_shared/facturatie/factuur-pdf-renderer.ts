// PDF-renderer: FactuurDocument → factuur-PDF-input (header + regels).
//
// Levert de canonieke regels (omschrijving = de gedeelde Artikelpresentatie-
// artikeltekst, identiek aan wat EDI als articleDescription stuurt) zodat de
// factuur-PDF dezelfde artikeltekst toont als de INVOIC (ADR-0036 besluit
// 2026-06-14). Bedrijf/logo en de PDF-specifieke verrijking (m²-/gewicht-totalen,
// afleveradres-per-order) blijven bij de caller — die horen niet in het gedeelde
// document. Pure functie.

import type { FactuurHeader, FactuurPDFRegel } from '../factuur-pdf.ts'
import type { FactuurDocument } from './factuur-document.ts'

export interface FactuurPdfDocumentDeel {
  factuur: FactuurHeader
  regels: FactuurPDFRegel[]
}

/**
 * Map het Factuurdocument naar het doc-gedreven deel van de factuur-PDF-input.
 * De caller voegt bedrijf + logo toe, en mag per regel `afleveradres` en op de
 * header `totaal_m2`/`totaal_gewicht_kg` verrijken (PDF-specifiek).
 */
export function naarFactuurPdfInput(doc: FactuurDocument): FactuurPdfDocumentDeel {
  const h = doc.header
  const factuur: FactuurHeader = {
    factuur_nr: h.factuur_nr,
    factuurdatum: h.factuurdatum,
    debiteur_nr: h.debiteur_nr,
    vertegenwoordiger: h.vertegenwoordiger,
    fact_naam: h.fact_naam,
    fact_adres: h.fact_adres,
    fact_postcode: h.fact_postcode,
    fact_plaats: h.fact_plaats,
    subtotaal: h.subtotaal,
    btw_percentage: h.btw_percentage,
    btw_bedrag: h.btw_bedrag,
    totaal: h.totaal,
    btw_verlegd: h.btw_verlegd,
    btw_nummer_afnemer: h.btw_nummer_afnemer,
  }

  const regels: FactuurPDFRegel[] = doc.regels.map((r) => ({
    order_nr: r.order_nr,
    uw_referentie: r.uw_referentie,
    artikelnr: r.artikelnr,
    aantal: r.aantal,
    eenheid: r.eenheid,
    // Gedeelde Artikelpresentatie — dezelfde tekst als de EDI-articleDescription.
    omschrijving: r.presentatie.artikel_tekst,
    // Mig 406: klant_referentie als extra sub-regel achter omschrijving_2.
    omschrijving_2: [r.omschrijving_2, r.klant_referentie ? `Ref: ${r.klant_referentie}` : null]
      .filter(Boolean).join('\n') || undefined,
    prijs: r.prijs,
    bedrag: r.bedrag,
  }))

  return { factuur, regels }
}
