// Factuurdocument — de canonieke, opgeloste representatie van een factuur
// (CONTEXT.md: Factuurdocument). Header + regels mét Artikelpresentatie en
// toegepaste BTW-verlegging. De drie renderers (factuur-PDF, EDI-INVOIC
// automatisch + handmatig) zijn dunne renderers op dit ene document i.p.v.
// drie onafhankelijke afleidingen uit factuur_regels/order_regels/producten.
//
// Pure builder `bouwFactuurDocument` (los te golden-testen) + dunne IO-fetch
// `fetchFactuurDocument`. ADR-0036 slice 2 — nog niet gewired (additief).

import { effectiefBtwPct } from '../btw.ts'
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
  aantal: number | string
  prijs: number | string
  bedrag: number | string
  btw_percentage: number | string
}

export interface FactuurDocumentLookups {
  orderRegels: Map<number, OrderRegelLookup>
  producten: Map<string, ProductLookup>
  klantArtikelen: Map<string, KlantArtikelLookup>
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
    const presentatie = resolveArtikelPresentatie(
      { artikelnr: r.artikelnr, omschrijving: r.omschrijving, omschrijving_2: r.omschrijving_2, aantal },
      {
        orderRegel: lookups.orderRegels.get(r.order_regel_id) ?? null,
        product: r.artikelnr ? lookups.producten.get(r.artikelnr) ?? null : null,
        klantArtikel: r.artikelnr ? lookups.klantArtikelen.get(r.artikelnr) ?? null : null,
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
      uw_referentie: r.uw_referentie ?? '',
      artikelnr: r.artikelnr ?? '',
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
          'uw_referentie, order_nr, aantal, prijs, bedrag, btw_percentage',
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

  const [orderRegelsRes, productenRes, klantArtikelenRes] = await Promise.all([
    orderRegelIds.length
      ? supabase.from('order_regels').select('id, karpi_code, gewicht_kg').in('id', orderRegelIds)
      : Promise.resolve({ data: [], error: null }),
    artikelnrs.length
      ? supabase
          .from('producten')
          .select('artikelnr, karpi_code, omschrijving, omschrijving_2, ean_code, gewicht_kg')
          .in('artikelnr', artikelnrs)
      : Promise.resolve({ data: [], error: null }),
    artikelnrs.length
      ? supabase
          .from('klant_artikelnummers')
          .select('artikelnr, klant_artikel, omschrijving')
          .eq('debiteur_nr', debiteurNr)
          .in('artikelnr', artikelnrs)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (orderRegelsRes.error) throw new Error(`Fetch order_regels: ${orderRegelsRes.error.message}`)
  if (productenRes.error) throw new Error(`Fetch producten: ${productenRes.error.message}`)
  if (klantArtikelenRes.error) throw new Error(`Fetch klant_artikelnummers: ${klantArtikelenRes.error.message}`)

  const orderRegels = new Map<number, OrderRegelLookup>()
  for (const r of orderRegelsRes.data ?? []) {
    orderRegels.set(Number(r.id), { karpi_code: r.karpi_code, gewicht_kg: r.gewicht_kg })
  }
  const producten = new Map<string, ProductLookup>()
  for (const p of productenRes.data ?? []) {
    producten.set(p.artikelnr, {
      karpi_code: p.karpi_code,
      omschrijving: p.omschrijving,
      omschrijving_2: p.omschrijving_2,
      ean_code: p.ean_code,
      gewicht_kg: p.gewicht_kg,
    })
  }
  const klantArtikelen = new Map<string, KlantArtikelLookup>()
  for (const k of klantArtikelenRes.data ?? []) {
    klantArtikelen.set(k.artikelnr, { klant_artikel: k.klant_artikel, omschrijving: k.omschrijving })
  }

  return { orderRegels, producten, klantArtikelen }
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
