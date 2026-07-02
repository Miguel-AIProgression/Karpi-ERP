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
    fact_land: h.fact_land ?? null,
    subtotaal: h.subtotaal,
    btw_percentage: h.btw_percentage,
    btw_bedrag: h.btw_bedrag,
    totaal: h.totaal,
    btw_verlegd: h.btw_verlegd,
    btw_nummer_afnemer: h.btw_nummer_afnemer,
    toeslag_bedrag: h.toeslag_bedrag,
    toeslag_omschrijving: h.toeslag_omschrijving,
    toeslag_procent: h.toeslag_procent,
  }

  const regels: FactuurPDFRegel[] = doc.regels.map((r) => {
    const klantRef = r.klant_referentie ? `Ref: ${r.klant_referentie}` : null
    // Tapijt-regel met klant-titel (kwaliteitnaam/klant-eigennaam − afmeting):
    // één regel, géén Karpi-code in de hoofdregel (lost de dubbele op). Andere
    // regels (VERZEND/toeslagen/admin-pseudo, geen kwaliteit/maat) houden de
    // bestaande artikeltekst + sub-regels (geen regressie). De afwerking zit
    // bij die andere regels al in `artikel_tekst` — bij een klant-titel zou ze
    // anders stilletjes verdwijnen, dus die komt hier terug als losse regel.
    //
    // Karpi-code-fix: de Karpi-eigen artikelcode (PATS23XX060090) verdween
    // volledig zodra een klant-titel getoond werd — de klant zag alleen het
    // numerieke artikelnummer (Artikel-kolom) zonder de Karpi-code, terwijl
    // het oude systeem beide toonde. Komt nu terug als losse regel.
    const titel = r.presentatie.klant_titel
    const afwerkingRegel = titel && r.presentatie.afwerking ? `Afwerking: ${r.presentatie.afwerking}` : null
    const karpiCodeRegel = titel && r.presentatie.karpi_code ? `Karpi: ${r.presentatie.karpi_code}` : null
    return {
      order_nr: r.order_nr,
      uw_referentie: r.uw_referentie,
      artikelnr: r.artikelnr,
      aantal: r.aantal,
      eenheid: r.eenheid,
      omschrijving: titel ?? r.presentatie.artikel_tekst,
      omschrijving_2: titel
        ? ([karpiCodeRegel, afwerkingRegel, klantRef].filter(Boolean).join('\n') || undefined)
        : ([r.omschrijving_2, klantRef].filter(Boolean).join('\n') || undefined),
      // Klant-eigennaam als apart veld — factuur-pdf.ts vertaalt het label naar de klanttaal.
      klant_model: r.presentatie.klant_model ?? null,
      prijs: r.prijs,
      bedrag: r.bedrag,
    }
  })

  return { factuur, regels }
}
