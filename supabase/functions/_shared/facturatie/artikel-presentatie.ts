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

import { factuurProductTitel } from './factuur-product-titel.ts'

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
  /** Maatwerk-velden voor de klant-titel (kwaliteitnaam − afmeting) op de PDF-factuur. */
  is_maatwerk?: boolean | null
  maatwerk_lengte_cm?: number | null
  maatwerk_breedte_cm?: number | null
  /** Kwaliteit/kleur-snapshot — bron voor de klant-eigennaam-lookup (factuur-document). */
  maatwerk_kwaliteit_code?: string | null
  maatwerk_kleur_code?: string | null
  /** Al-opgeloste afwerkingstekst (afwerkingPresentatie), bv. "Breedband - band KK21". */
  afwerking?: string | null
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
  /** Bron voor de kwaliteitnaam op de klant-titel (kwaliteiten.omschrijving is leeg). */
  vervolgomschrijving?: string | null
  /** Vaste-maat-product-afmeting voor de klant-titel. */
  lengte_cm?: number | null
  breedte_cm?: number | null
  /** Kwaliteit/kleur — bron voor de klant-eigennaam-lookup (factuur-document). */
  kwaliteit_code?: string | null
  kleur_code?: string | null
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
  /** Al-geresolvde klant-eigennaam (resolve_klanteigen_naam) of null — wint op de klant-titel. */
  klantEigenNaam?: string | null
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
  /**
   * Klant-facing titel voor de PDF-factuur: "kwaliteitnaam − afmeting"
   * (bv. "Galaxy - 60x90 cm"); null als niet samen te stellen (geen
   * kwaliteit/maat). ALLEEN de PDF-renderer leest dit — de EDI-INVOIC blijft
   * `artikel_tekst` gebruiken. */
  klant_titel: string | null
  /**
   * Al-geresolvde klant-eigennaam (resolve_klanteigen_naam) — verschijnt als
   * sub-regel "Uw model: …" op PDF-factuur, orderbevestiging-PDF en pakbon.
   * Null als de debiteur geen eigen naam heeft voor dit artikel. */
  klant_model: string | null
  /**
   * Al-opgeloste afwerkingstekst (bv. "Breedband - band KK21"), ongewijzigd
   * doorgegeven uit de lookup. Zit al verwerkt in `omschrijving`/`artikel_tekst`
   * — apart blootgesteld zodat een renderer die in plaats daarvan `klant_titel`
   * toont (PDF) de afwerking als losse regel kan terugzetten i.p.v. 'm stilletjes
   * te laten vallen. */
  afwerking: string | null
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
  const { orderRegel, product, klantArtikel, klantEigenNaam } = lookups

  const karpi_code = resolveKarpiCode(orderRegel?.karpi_code, product?.karpi_code, regel.artikelnr)
  const basisOmschrijving =
    firstNonEmpty(klantArtikel?.omschrijving, regel.omschrijving, product?.omschrijving, regel.omschrijving_2) ?? ''
  // Afwerking als suffix — al opgelost door de caller (afwerkingPresentatie),
  // zodat deze pure resolver geen afwerking_types-lookup nodig heeft.
  const omschrijving = orderRegel?.afwerking
    ? `${basisOmschrijving} - afwerking: ${orderRegel.afwerking}`
    : basisOmschrijving
  const gtin = product?.ean_code ?? ''
  const klant_artikel = klantArtikel?.klant_artikel ?? ''

  // Gewicht: orderRegel-snapshot wint; anders product × aantal.
  const gewichtPerRegel = toNumber(orderRegel?.gewicht_kg, NaN)
  const gewicht_kg = Number.isFinite(gewichtPerRegel)
    ? gewichtPerRegel
    : toNumber(product?.gewicht_kg, 0) * regel.aantal

  const artikel_tekst = [karpi_code, omschrijving].filter(Boolean).join(' ')

  // Klant-titel voor de PDF (kwaliteitnaam/klant-eigennaam − afmeting); null als
  // niet samen te stellen → de PDF-renderer valt terug op artikel_tekst.
  const klant_titel = factuurProductTitel({
    isMaatwerk: orderRegel?.is_maatwerk === true,
    maatwerkLengteCm: orderRegel?.maatwerk_lengte_cm ?? null,
    maatwerkBreedteCm: orderRegel?.maatwerk_breedte_cm ?? null,
    vervolgomschrijving: product?.vervolgomschrijving ?? null,
    prodLengteCm: product?.lengte_cm ?? null,
    prodBreedteCm: product?.breedte_cm ?? null,
  })

  return {
    karpi_code,
    klant_artikel,
    gtin,
    gewicht_kg,
    omschrijving,
    artikel_tekst,
    klant_titel,
    klant_model: klantEigenNaam ?? null,
    afwerking: orderRegel?.afwerking ?? null,
  }
}
