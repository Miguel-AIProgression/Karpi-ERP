// Artikelpresentatie — gedeelde resolver voor hoe het artikel van een
// factuur-/orderregel op een klantdocument verschijnt (CONTEXT.md: Artikelpresentatie).
//
// Lost per regel de presentatie-velden op uit (regel + order_regel-snapshot +
// product + klant-artikelnummer): karpi_code, klant_artikel (buyerArticleNumber),
// GTIN, gewicht en de definitieve omschrijving + samengestelde artikeltekst.
//
// Pure transformatie — geen DB/netwerk (ADR-0033). De IO-fetch die de lookup-maps
// vult leeft apart (factuur-document.ts / orderbevestiging) zodat dit los te
// unit-testen is. Geëxtraheerd uit de inline resolve in factuur-verzenden
// `buildEdiFactuurInput` (gedragsneutraal — zelfde fallback-ladders).

/** De regel waarvoor we de presentatie oplossen (factuur_regels of order_regels). */
export interface ArtikelPresentatieRegel {
  artikelnr: string | null
  omschrijving?: string | null
  omschrijving_2?: string | null
  aantal: number
}

/** order_regels-snapshot: karpi_code + gewicht winnen van het product (regel-snapshot). */
export interface OrderRegelLookup {
  karpi_code: string | null
  gewicht_kg: number | null
}

/** producten-rij. NB: `producten` heeft GÉÉN omschrijving_2-kolom — de omschrijving-
 *  ladder gebruikt `regel.omschrijving_2`, niet die van het product. Daarom wordt
 *  `omschrijving_2` hier niet uit de DB gehaald (optioneel/ongebruikt veld). */
export interface ProductLookup {
  karpi_code: string | null
  omschrijving: string | null
  omschrijving_2?: string | null
  ean_code: string | null
  gewicht_kg: number | null
}

/** klant_artikelnummers-rij (per debiteur). */
export interface KlantArtikelLookup {
  klant_artikel: string | null
  omschrijving: string | null
}

export interface ArtikelPresentatieLookups {
  orderRegel?: OrderRegelLookup | null
  product?: ProductLookup | null
  klantArtikel?: KlantArtikelLookup | null
}

/** De opgeloste presentatie. Voedt zowel het Factuurdocument als de orderbevestiging. */
export interface ArtikelPresentatie {
  /** Karpi's eigen artikelcode (orderRegel → product → fallback artikelnr); '' als alles leeg. */
  karpi_code: string
  /** Klant-artikelnummer → EDI buyerArticleNumber; '' als de klant er geen heeft. */
  klant_artikel: string
  /** GTIN uit producten.ean_code; '' als niet gevonden. */
  gtin: string
  /** Opgelost gewicht in kg (orderRegel-snapshot wint van product × aantal); 0 als onbekend. */
  gewicht_kg: number
  /** Opgeloste omschrijving (klant_artikel → regel → product → regel.omschrijving_2); '' als alles leeg. */
  omschrijving: string
  /** Samengestelde artikeltekst "[karpi_code] [omschrijving]" — gedeeld door PDF én EDI. */
  artikel_tekst: string
}

/** Eerste waarde die getrimd niet-leeg is, anders null. Spiegelt factuur-verzenden. */
function firstNonEmpty(...values: Array<string | number | null | undefined>): string | null {
  for (const value of values) {
    if (value == null) continue
    const s = String(value).trim()
    if (s !== '') return s
  }
  return null
}

function toNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * De karpi_code-ladder: order_regel-snapshot → product → fallback artikelnr.
 * Gedeeld zodat factuur (Factuurdocument) en orderbevestiging dezelfde Karpi-code
 * tonen. Retourneert '' als alles leeg is (caller mag dat naar null mappen).
 */
export function resolveKarpiCode(
  orderRegelKarpiCode: string | null | undefined,
  productKarpiCode: string | null | undefined,
  artikelnr: string | null | undefined,
): string {
  return firstNonEmpty(orderRegelKarpiCode, productKarpiCode, artikelnr) ?? ''
}

/**
 * Los de Artikelpresentatie van één regel op uit de lookup-maps.
 * Gedragsneutraal t.o.v. de inline resolve in factuur-verzenden buildEdiFactuurInput.
 */
export function resolveArtikelPresentatie(
  regel: ArtikelPresentatieRegel,
  lookups: ArtikelPresentatieLookups = {},
): ArtikelPresentatie {
  const { orderRegel, product, klantArtikel } = lookups

  const karpi_code = resolveKarpiCode(orderRegel?.karpi_code, product?.karpi_code, regel.artikelnr)
  const omschrijving =
    firstNonEmpty(klantArtikel?.omschrijving, regel.omschrijving, product?.omschrijving, regel.omschrijving_2) ?? ''
  const gtin = product?.ean_code ?? ''
  const klant_artikel = klantArtikel?.klant_artikel ?? ''

  // Gewicht: orderRegel-snapshot wint; anders product × aantal.
  const gewichtPerRegel = toNumber(orderRegel?.gewicht_kg, NaN)
  const gewicht_kg = Number.isFinite(gewichtPerRegel)
    ? gewichtPerRegel
    : toNumber(product?.gewicht_kg, 0) * regel.aantal

  const artikel_tekst = [karpi_code, omschrijving].filter(Boolean).join(' ')

  return { karpi_code, klant_artikel, gtin, gewicht_kg, omschrijving, artikel_tekst }
}
