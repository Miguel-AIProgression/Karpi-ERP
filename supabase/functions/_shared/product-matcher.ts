// Mapping webshop-orderregel → RugFlow `producten.artikelnr`.
//
// Strategie (eerste hit wint):
//   1. Service-regel detectie (verzendkosten → VERZEND)
//   2. articleCode / sku match op producten.karpi_code (primair voor Floorpassion)
//   3. articleCode / sku match op producten.artikelnr
//   4. ean_code match
//   5. Parse productTitle + variantTitle → bouw karpi_code kandidaten + zoek
//   6. productTitle omschrijving ilike — alleen unieke match
// Geen match → caller maakt placeholder-regel met NULL artikelnr + prefix.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { LightspeedOrderRow } from './lightspeed-client.ts'

export type MatchBron =
  | 'verzend'
  | 'karpi_code'
  | 'artikelnr'
  | 'ean'
  | 'parsed_karpi'
  | 'omschrijving'
  | 'geen'

export type UnmatchedReden = 'muster' | 'wunschgrosse' | 'durchmesser' | 'overig' | null

export interface ProductMatch {
  artikelnr: string | null
  matchedOn: MatchBron
  unmatchedReden?: UnmatchedReden
}

const VERZEND_PATROON = /verzend|versand|shipping/i
const MUSTER_PATROON = /muster|sample|gratis\s+staal/i
const WUNSCHGROSSE_PATROON = /wunschgr[öo]ß?e|op\s+maat|custom\s+size|volgens\s+tekening/i
const DURCHMESSER_PATROON = /durchmesser|diameter|rond\s+\d|rund\s+\d/i
const AFMETING_PATROON = /(\d{2,3})\s*x\s*(\d{2,3})\s*cm/i

function uniekeCodes(row: LightspeedOrderRow): string[] {
  const set = new Set<string>()
  for (const v of [row.articleCode, row.sku]) {
    const t = v?.trim()
    if (t) set.add(t)
  }
  return Array.from(set)
}

// "Firenze 12 - Niederflorteppich" → { basis: "Firenze", kleur: "12" }
// "Beach Life 20 - Wollteppich"    → { basis: "Beach Life", kleur: "20" }
// "Fay Beige - Kuschelteppich"     → { basis: "Fay Beige", kleur: null }
function parseTitel(titel: string): { basis: string; kleur: string | null } {
  const clean = titel.replace(/\s*-.*$/, '').trim() // strip alles na eerste " - "
  const kleurMatch = clean.match(/^(.+?)\s+(\d{1,3})\s*$/)
  if (kleurMatch) return { basis: kleurMatch[1].trim(), kleur: kleurMatch[2] }
  return { basis: clean, kleur: null }
}

// "130x190 cm" / "200 x 290 cm" → [130, 190]
function parseAfmeting(txt: string | null | undefined): [number, number] | null {
  if (!txt) return null
  const m = txt.match(AFMETING_PATROON)
  if (!m) return null
  return [Number(m[1]), Number(m[2])]
}

function classifyRow(row: LightspeedOrderRow): UnmatchedReden {
  const hay = `${row.productTitle ?? ''} ${row.variantTitle ?? ''}`
  if (MUSTER_PATROON.test(hay)) return 'muster'
  if (WUNSCHGROSSE_PATROON.test(hay)) return 'wunschgrosse'
  if (DURCHMESSER_PATROON.test(hay)) return 'durchmesser'
  return null
}

async function zoekOpKarpi(
  supabase: SupabaseClient,
  codes: string[],
): Promise<string | null> {
  if (codes.length === 0) return null
  const { data } = await supabase
    .from('producten')
    .select('artikelnr')
    .in('karpi_code', codes)
    .limit(1)
  return data && data.length > 0 ? data[0].artikelnr : null
}

async function zoekViaParsing(
  supabase: SupabaseClient,
  row: LightspeedOrderRow,
): Promise<string | null> {
  const { basis, kleur } = parseTitel(row.productTitle ?? '')
  const afm = parseAfmeting(row.variantTitle ?? '') ?? parseAfmeting(row.productTitle ?? '')
  if (!basis || !kleur || !afm) return null

  // Kandidaten: "{4LETTERS}{KK}XX{LLL}{BBB}" en omgedraaid.
  // basis kan meerdere woorden zijn (Beach Life, Velvet Touch) — neem eerste 4 letters.
  const prefix = basis.replace(/\s+/g, '').slice(0, 4).toUpperCase()
  const kleurP = kleur.padStart(2, '0')
  const [a, b] = afm
  const aP = String(a).padStart(3, '0')
  const bP = String(b).padStart(3, '0')
  const kandidaten = [
    `${prefix}${kleurP}XX${aP}${bP}`,
    `${prefix}${kleurP}XX${bP}${aP}`,
  ]
  return zoekOpKarpi(supabase, kandidaten)
}

export async function matchProduct(
  supabase: SupabaseClient,
  row: LightspeedOrderRow,
): Promise<ProductMatch> {
  // 0. Verzendkosten
  const titleBlob = `${row.productTitle ?? ''} ${row.variantTitle ?? ''}`
  if (VERZEND_PATROON.test(titleBlob)) {
    const { data } = await supabase
      .from('producten')
      .select('artikelnr')
      .eq('artikelnr', 'VERZEND')
      .limit(1)
    if (data && data.length > 0) {
      return { artikelnr: 'VERZEND', matchedOn: 'verzend' }
    }
  }

  const codes = uniekeCodes(row)

  // 1. karpi_code match (Floorpassion stuurt karpi-codes in articleCode)
  const karpiHit = await zoekOpKarpi(supabase, codes)
  if (karpiHit) return { artikelnr: karpiHit, matchedOn: 'karpi_code' }

  // 2. artikelnr match
  if (codes.length > 0) {
    const { data } = await supabase
      .from('producten')
      .select('artikelnr')
      .in('artikelnr', codes)
      .limit(1)
    if (data && data.length > 0) {
      return { artikelnr: data[0].artikelnr, matchedOn: 'artikelnr' }
    }
  }

  // 3. ean_code
  if (row.ean?.trim()) {
    const { data } = await supabase
      .from('producten')
      .select('artikelnr')
      .eq('ean_code', row.ean.trim())
      .limit(1)
    if (data && data.length > 0) {
      return { artikelnr: data[0].artikelnr, matchedOn: 'ean' }
    }
  }

  // 4. Parse titel + variant → probeer karpi_code op te bouwen
  const parsedHit = await zoekViaParsing(supabase, row)
  if (parsedHit) return { artikelnr: parsedHit, matchedOn: 'parsed_karpi' }

  // 5. omschrijving ilike (alleen unieke match)
  const naam = row.productTitle?.trim()
  if (naam) {
    const { data } = await supabase
      .from('producten')
      .select('artikelnr')
      .ilike('omschrijving', naam)
      .limit(2)
    if (data && data.length === 1) {
      return { artikelnr: data[0].artikelnr, matchedOn: 'omschrijving' }
    }
  }

  return { artikelnr: null, matchedOn: 'geen', unmatchedReden: classifyRow(row) }
}

// Bouw de omschrijving-string die in order_regels landt.
// Geeft [VERZEND] / [STAAL] / [MAATWERK] / [UNMATCHED] prefix bij geen match,
// zodat het in de UI direct herkenbaar is waarom er geen artikelnr is.
export function buildOmschrijving(
  row: LightspeedOrderRow,
  match: ProductMatch,
): string {
  const base = [row.productTitle, row.variantTitle].filter(Boolean).join(' — ').trim()
  if (match.artikelnr) return base
  const prefix = (() => {
    switch (match.unmatchedReden) {
      case 'muster':
        return '[STAAL]'
      case 'wunschgrosse':
        return '[MAATWERK]'
      case 'durchmesser':
        return '[MAATWERK-ROND]'
      default:
        return '[UNMATCHED]'
    }
  })()
  return `${prefix} ${base || row.articleCode || row.sku || 'onbekend'}`
}
