// Factuurdocument — de canonieke, opgeloste representatie van een factuur
// (CONTEXT.md: Factuurdocument). Header + regels mét Artikelpresentatie en
// toegepaste BTW-verlegging. De drie renderers (factuur-PDF, EDI-INVOIC
// automatisch + handmatig) zijn dunne renderers op dit ene document i.p.v.
// drie onafhankelijke afleidingen uit factuur_regels/order_regels/producten.
//
// Pure builder `bouwFactuurDocument` (los te golden-testen) + dunne IO-fetch
// `fetchFactuurDocument`. ADR-0036 slice 2 — nog niet gewired (additief).

import { effectiefBtwPct } from '../btw.ts'
import { externReferentie } from '../referentie.ts'
import { afwerkingPresentatie, fetchAfwerkingTypeMap } from '../afwerking-presentatie.ts'
import {
  resolveArtikelPresentatie,
  type ArtikelPresentatie,
  type KlantArtikelLookup,
  type OrderRegelLookup,
  type ProductLookup,
} from './artikel-presentatie.ts'

// ---------------------------------------------------------------------------
// Canonieke shapes
// ---------------------------------------------------------------------------

export interface FactuurDocumentHeader {
  factuur_nr: string
  factuurdatum: string // ISO YYYY-MM-DD
  debiteur_nr: number
  vertegenwoordiger: string
  fact_naam: string
  fact_adres: string
  fact_postcode: string
  fact_plaats: string
  fact_land: string | null
  subtotaal: number
  btw_percentage: number
  btw_bedrag: number
  totaal: number
  /** Factuur-snapshot (facturen.btw_verlegd, mig 371) — canonieke verlegd-bron. */
  btw_verlegd: boolean
  btw_nummer_afnemer: string | null
}

export interface FactuurDocumentRegel {
  regelnummer: number
  order_id: number
  order_regel_id: number
  order_nr: string
  uw_referentie: string
  artikelnr: string
  /** Rauwe tweede omschrijvingsregel (PDF-sub-regels); EDI gebruikt artikel_tekst. */
  omschrijving_2: string | null
  /** Mig 406: per-orderregel klantreferentie (snapshot van order_regels.klant_referentie). */
  klant_referentie: string | null
  aantal: number
  /** Verkoopeenheid op de factuur; vast 'St' (mirrors huidige PDF). */
  eenheid: string
  prijs: number
  bedrag: number
  /** Effectief BTW-percentage: 0 bij verlegd, anders het regel-tarief. */
  btw_percentage: number
  presentatie: ArtikelPresentatie
}

export interface FactuurDocument {
  header: FactuurDocumentHeader
  regels: FactuurDocumentRegel[]
  isTestMessage: boolean
}

// ---------------------------------------------------------------------------
// Raw rows (subset die de builder leest)
// ---------------------------------------------------------------------------

export interface FactuurDocumentFactuurRow {
  factuur_nr: string
  factuurdatum: string
  debiteur_nr: number
  fact_naam: string | null
  fact_adres: string | null
  fact_postcode: string | null
  fact_plaats: string | null
  fact_land: string | null
  btw_nummer: string | null
  subtotaal: number | string
  btw_percentage: number | string
  btw_bedrag: number | string
  totaal: number | string
  btw_verlegd: boolean | null
}

export interface FactuurDocumentRegelRow {
  order_id: number
  order_regel_id: number
  regelnummer: number
  artikelnr: string | null
  omschrijving: string | null
  omschrijving_2: string | null
  uw_referentie: string | null
  order_nr: string | null
  /** Mig 406: per-orderregel klantreferentie. */
  klant_referentie?: string | null
  aantal: number | string
  prijs: number | string
  bedrag: number | string
  btw_percentage: number | string
}

export interface FactuurDocumentLookups {
  orderRegels: Map<number, OrderRegelLookup>
  producten: Map<string, ProductLookup>
  klantArtikelen: Map<string, KlantArtikelLookup>
  /** Klant-eigennaam per "kwaliteit_code|kleur_code" (resolve_klanteigen_naam). */
  klantEigenNamen: Map<string, string>
}

/** Sleutel voor de klant-eigennaam-map; kleur leeg → ''. */
function klantEigenNaamSleutel(kwaliteitCode: string | null, kleurCode: string | null): string {
  return `${kwaliteitCode}|${kleurCode ?? ''}`
}

function num(value: number | string | null | undefined): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

const EENHEID = 'St'

// ---------------------------------------------------------------------------
// Pure builder
// ---------------------------------------------------------------------------

export function bouwFactuurDocument(
  factuur: FactuurDocumentFactuurRow,
  regelRows: FactuurDocumentRegelRow[],
  lookups: FactuurDocumentLookups,
  opts: { vertegenwoordiger: string; isTestMessage: boolean },
): FactuurDocument {
  const verlegd = factuur.btw_verlegd === true

  const header: FactuurDocumentHeader = {
    factuur_nr: factuur.factuur_nr,
    factuurdatum: factuur.factuurdatum,
    debiteur_nr: factuur.debiteur_nr,
    vertegenwoordiger: opts.vertegenwoordiger,
    fact_naam: factuur.fact_naam ?? '',
    fact_adres: factuur.fact_adres ?? '',
    fact_postcode: factuur.fact_postcode ?? '',
    fact_plaats: factuur.fact_plaats ?? '',
    fact_land: factuur.fact_land ?? null,
    subtotaal: num(factuur.subtotaal),
    btw_percentage: num(factuur.btw_percentage),
    btw_bedrag: num(factuur.btw_bedrag),
    totaal: num(factuur.totaal),
    btw_verlegd: verlegd,
    btw_nummer_afnemer: factuur.btw_nummer ?? null,
  }

  const regels: FactuurDocumentRegel[] = regelRows.map((r) => {
    const aantal = num(r.aantal)
    const orderRegel = lookups.orderRegels.get(r.order_regel_id) ?? null
    const product = r.artikelnr ? lookups.producten.get(r.artikelnr) ?? null : null
    // Kwaliteit/kleur: maatwerk-snapshot wint van het product (mirror orderbevestiging).
    const kwaliteitCode = orderRegel?.maatwerk_kwaliteit_code ?? product?.kwaliteit_code ?? null
    const kleurCode = orderRegel?.maatwerk_kleur_code ?? product?.kleur_code ?? null
    const klantEigenNaam = kwaliteitCode
      ? lookups.klantEigenNamen.get(klantEigenNaamSleutel(kwaliteitCode, kleurCode)) ?? null
      : null
    const presentatie = resolveArtikelPresentatie(
      { artikelnr: r.artikelnr, omschrijving: r.omschrijving, omschrijving_2: r.omschrijving_2, aantal },
      {
        orderRegel,
        product,
        klantArtikel: r.artikelnr ? lookups.klantArtikelen.get(r.artikelnr) ?? null : null,
        klantEigenNaam,
      },
    )
    // Effectief BTW-tarief via de gedeelde seam: verlegd (factuur-snapshot) wint.
    const btw_percentage = effectiefBtwPct({
      btw_verlegd_intracom: verlegd,
      btw_percentage: num(r.btw_percentage),
    })
    return {
      regelnummer: r.regelnummer,
      order_id: r.order_id,
      order_regel_id: r.order_regel_id,
      order_nr: r.order_nr ?? '',
      uw_referentie: externReferentie(r.uw_referentie) ?? '',
      artikelnr: r.artikelnr ?? '',
      omschrijving_2: r.omschrijving_2 ?? null,
      klant_referentie: r.klant_referentie ?? null,
      aantal,
      eenheid: EENHEID,
      prijs: num(r.prijs),
      bedrag: num(r.bedrag),
      btw_percentage,
      presentatie,
    }
  })

  return { header, regels, isTestMessage: opts.isTestMessage }
}

// ---------------------------------------------------------------------------
// IO-fetch (dunne plumbing rond de pure builder)
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type SupabaseClient = any

/**
 * Haal de ruwe factuur-data op en bouw het Factuurdocument. Eén plek die de
 * Artikelpresentatie-lookups vult; de renderers consumeren het document.
 */
export async function fetchFactuurDocument(
  supabase: SupabaseClient,
  factuurId: number,
  opts: { isTestMessage?: boolean } = {},
): Promise<FactuurDocument> {
  const [factuurRes, regelsRes] = await Promise.all([
    supabase
      .from('facturen')
      .select(
        'factuur_nr, factuurdatum, debiteur_nr, fact_naam, fact_adres, fact_postcode, ' +
          'fact_plaats, fact_land, btw_nummer, subtotaal, btw_percentage, btw_bedrag, totaal, btw_verlegd',
      )
      .eq('id', factuurId)
      .maybeSingle(),
    supabase
      .from('factuur_regels')
      .select(
        'order_id, order_regel_id, regelnummer, artikelnr, omschrijving, omschrijving_2, ' +
          'uw_referentie, order_nr, klant_referentie, aantal, prijs, bedrag, btw_percentage',
      )
      .eq('factuur_id', factuurId)
      .order('regelnummer'),
  ])

  if (factuurRes.error) throw new Error(`Fetch factuur: ${factuurRes.error.message}`)
  if (!factuurRes.data) throw new Error(`Factuur ${factuurId} niet gevonden`)
  if (regelsRes.error) throw new Error(`Fetch factuur_regels: ${regelsRes.error.message}`)

  const factuur = factuurRes.data as FactuurDocumentFactuurRow
  const regelRows = (regelsRes.data ?? []) as FactuurDocumentRegelRow[]

  const lookups = await fetchFactuurDocumentLookups(supabase, factuur.debiteur_nr, regelRows)
  const vertegenwoordiger = await fetchVertegenwoordiger(supabase, factuur.debiteur_nr)

  return bouwFactuurDocument(factuur, regelRows, lookups, {
    vertegenwoordiger,
    isTestMessage: opts.isTestMessage ?? false,
  })
}

async function fetchFactuurDocumentLookups(
  supabase: SupabaseClient,
  debiteurNr: number,
  regelRows: FactuurDocumentRegelRow[],
): Promise<FactuurDocumentLookups> {
  const orderRegelIds = uniqueNumbers(regelRows.map((r) => r.order_regel_id))
  const artikelnrs = uniqueStrings(regelRows.map((r) => r.artikelnr))

  const [orderRegelsRes, productenRes, klantArtikelenRes, afwerkingTypes] = await Promise.all([
    orderRegelIds.length
      ? supabase
          .from('order_regels')
          .select(
            'id, karpi_code, gewicht_kg, is_maatwerk, maatwerk_lengte_cm, maatwerk_breedte_cm, ' +
              'maatwerk_kwaliteit_code, maatwerk_kleur_code, maatwerk_afwerking, maatwerk_band_kleur',
          )
          .in('id', orderRegelIds)
      : Promise.resolve({ data: [], error: null }),
    artikelnrs.length
      ? supabase
          .from('producten')
          .select(
            'artikelnr, karpi_code, omschrijving, ean_code, gewicht_kg, ' +
              'vervolgomschrijving, lengte_cm, breedte_cm, kwaliteit_code, kleur_code',
          )
          .in('artikelnr', artikelnrs)
      : Promise.resolve({ data: [], error: null }),
    artikelnrs.length
      ? supabase
          .from('klant_artikelnummers')
          .select('artikelnr, klant_artikel, omschrijving')
          .eq('debiteur_nr', debiteurNr)
          .in('artikelnr', artikelnrs)
      : Promise.resolve({ data: [], error: null }),
    fetchAfwerkingTypeMap(supabase),
  ])

  if (orderRegelsRes.error) throw new Error(`Fetch order_regels: ${orderRegelsRes.error.message}`)
  if (productenRes.error) throw new Error(`Fetch producten: ${productenRes.error.message}`)
  if (klantArtikelenRes.error) throw new Error(`Fetch klant_artikelnummers: ${klantArtikelenRes.error.message}`)

  const orderRegels = new Map<number, OrderRegelLookup>()
  for (const r of orderRegelsRes.data ?? []) {
    orderRegels.set(Number(r.id), {
      karpi_code: r.karpi_code,
      gewicht_kg: r.gewicht_kg,
      is_maatwerk: r.is_maatwerk,
      maatwerk_lengte_cm: r.maatwerk_lengte_cm,
      maatwerk_breedte_cm: r.maatwerk_breedte_cm,
      maatwerk_kwaliteit_code: r.maatwerk_kwaliteit_code,
      maatwerk_kleur_code: r.maatwerk_kleur_code,
      afwerking: afwerkingPresentatie(r.maatwerk_afwerking, r.maatwerk_band_kleur, afwerkingTypes),
    })
  }
  const producten = new Map<string, ProductLookup>()
  for (const p of productenRes.data ?? []) {
    producten.set(p.artikelnr, {
      karpi_code: p.karpi_code,
      omschrijving: p.omschrijving,
      ean_code: p.ean_code,
      gewicht_kg: p.gewicht_kg,
      vervolgomschrijving: p.vervolgomschrijving,
      lengte_cm: p.lengte_cm,
      breedte_cm: p.breedte_cm,
      kwaliteit_code: p.kwaliteit_code,
      kleur_code: p.kleur_code,
    })
  }
  const klantArtikelen = new Map<string, KlantArtikelLookup>()
  for (const k of klantArtikelenRes.data ?? []) {
    klantArtikelen.set(k.artikelnr, { klant_artikel: k.klant_artikel, omschrijving: k.omschrijving })
  }

  const klantEigenNamen = await fetchKlantEigenNamen(supabase, debiteurNr, regelRows, orderRegels, producten)

  return { orderRegels, producten, klantArtikelen, klantEigenNamen }
}

/**
 * Bouw de klant-eigennaam-map per (kwaliteit_code, kleur_code) voor deze debiteur.
 * Spiegelt resolveKlantEigenNamen in stuur-orderbevestiging: maatwerk-snapshot wint
 * van het product, één RPC-call per uniek paar. NULL-resultaten worden niet gezet
 * → de regel valt terug op de kwaliteitnaam.
 */
async function fetchKlantEigenNamen(
  supabase: SupabaseClient,
  debiteurNr: number,
  regelRows: FactuurDocumentRegelRow[],
  orderRegels: Map<number, OrderRegelLookup>,
  producten: Map<string, ProductLookup>,
): Promise<Map<string, string>> {
  const uniek = new Map<string, { kwaliteit_code: string; kleur_code: string | null }>()
  for (const r of regelRows) {
    const orderRegel = orderRegels.get(r.order_regel_id)
    const product = r.artikelnr ? producten.get(r.artikelnr) : undefined
    const kwaliteitCode = orderRegel?.maatwerk_kwaliteit_code ?? product?.kwaliteit_code ?? null
    if (!kwaliteitCode) continue
    const kleurCode = orderRegel?.maatwerk_kleur_code ?? product?.kleur_code ?? null
    uniek.set(klantEigenNaamSleutel(kwaliteitCode, kleurCode), { kwaliteit_code: kwaliteitCode, kleur_code: kleurCode })
  }

  const resultaat = new Map<string, string>()
  for (const [sleutel, paar] of uniek) {
    const { data } = await supabase.rpc('resolve_klanteigen_naam', {
      p_debiteur_nr: debiteurNr,
      p_kwaliteit_code: paar.kwaliteit_code,
      p_kleur_code: paar.kleur_code,
    })
    if (data) resultaat.set(sleutel, data as string)
  }
  return resultaat
}

async function fetchVertegenwoordiger(supabase: SupabaseClient, debiteurNr: number): Promise<string> {
  const { data: deb } = await supabase
    .from('debiteuren')
    .select('vertegenw_code')
    .eq('debiteur_nr', debiteurNr)
    .maybeSingle()
  if (!deb?.vertegenw_code) return 'Niet van Toepassing'
  const { data: vert } = await supabase
    .from('vertegenwoordigers')
    .select('naam')
    .eq('code', deb.vertegenw_code)
    .maybeSingle()
  return vert?.naam ?? 'Niet van Toepassing'
}

function uniqueNumbers(values: Array<number | null | undefined>): number[] {
  return Array.from(new Set(values.filter((v): v is number => Number.isFinite(v as number))))
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v)))
}
