// Mapping webshop-orderregel → RugFlow `producten.artikelnr`.
//
// Strategie (eerste hit wint):
//   Als debiteurNr opgegeven → klanteigen_namen EERST (naam+kleur parsen):
//     a. maat aanwezig → zoek standaard artikel (ook gedraaid: 200x250 = 250x200)
//        gevonden → artikelnr; niet gevonden → maatwerk
//     b. geen maat → eerste hit op kwaliteit + kleur
//   Daarna fallback op codes (alleen als geen alias gevonden):
//   1. Service-regel detectie (verzendkosten → VERZEND)
//   2. articleCode / sku → producten.karpi_code
//   3. articleCode / sku → producten.artikelnr
//   4. ean_code match
//   5. Parse productTitle + variantTitle → bouw karpi_code kandidaten + zoek
//   6. productTitle omschrijving ilike — alleen unieke match

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { collectExtraTexts, type LightspeedOrderRow } from './lightspeed-client.ts'

export type MatchBron =
  | 'verzend'
  | 'karpi_code'
  | 'artikelnr'
  | 'ean'
  | 'alias'
  | 'parsed_karpi'
  | 'omschrijving'
  | 'maatwerk'
  | 'geen'

export type UnmatchedReden = 'muster' | 'wunschgrosse' | 'durchmesser' | 'overig' | null

export interface ProductMatch {
  artikelnr: string | null
  matchedOn: MatchBron
  unmatchedReden?: UnmatchedReden
  is_maatwerk?: boolean
  maatwerk_kwaliteit_code?: string | null
  maatwerk_kleur_code?: string | null
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

// "Ross 63 - Hochflor Teppich" → { naam: "Ross", kleur: "63" }
function splitNaamKleur(title: string): { naam: string; kleur: string | null } {
  const match = title.trim().match(/^(.+?)\s+(\d+)(\s|$|-|,)/)
  if (match) return { naam: match[1].trim(), kleur: match[2] }
  return { naam: title.trim(), kleur: null }
}

// "Firenze 12 - Niederflorteppich" → { basis: "Firenze", kleur: "12" }
function parseTitel(titel: string): { basis: string; kleur: string | null } {
  const clean = titel.replace(/\s*-.*$/, '').trim()
  const kleurMatch = clean.match(/^(.+?)\s+(\d{1,3})\s*$/)
  if (kleurMatch) return { basis: kleurMatch[1].trim(), kleur: kleurMatch[2] }
  return { basis: clean, kleur: null }
}

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

async function zoekOpKarpi(supabase: SupabaseClient, codes: string[]): Promise<string | null> {
  if (codes.length === 0) return null
  const { data } = await supabase
    .from('producten')
    .select('artikelnr')
    .in('karpi_code', codes)
    .limit(1)
  return data && data.length > 0 ? data[0].artikelnr : null
}

async function zoekViaParsing(supabase: SupabaseClient, row: LightspeedOrderRow): Promise<string | null> {
  const { basis, kleur } = parseTitel(row.productTitle ?? '')
  const afm = parseAfmeting(row.variantTitle ?? '') ?? parseAfmeting(row.productTitle ?? '')
  if (!basis || !kleur || !afm) return null

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
  debiteurNr?: number,
): Promise<ProductMatch> {

  // Klanteigen_namen EERST als debiteurNr bekend is — naam+kleur parsen heeft prioriteit
  // over code-matching zodat maatwerk-artikelen correct herkend worden.
  if (debiteurNr && row.productTitle?.trim()) {
    const { naam, kleur: kleurUitTitel } = splitNaamKleur(row.productTitle)
    const kleur = kleurUitTitel ?? row.variantTitle?.trim() ?? null

    const { data: aliases } = await supabase
      .from('klanteigen_namen')
      .select('kwaliteit_code')
      .eq('debiteur_nr', debiteurNr)
      .ilike('benaming', naam)

    if (aliases && aliases.length > 0 && kleur) {
      const kwaliteitCodes = aliases.map((a: { kwaliteit_code: string }) => a.kwaliteit_code)

      // Maat uit variantTitle, productTitle én customFields (bijv. "Afmeting: 120x120 (cm)")
      const sizeRaw = [
        row.variantTitle,
        row.productTitle,
        ...collectExtraTexts(row),
      ].join(' ').match(/(\d+)\s*[xX×]\s*(\d+)/)

      if (sizeRaw) {
        const maat        = `${sizeRaw[1]}x${sizeRaw[2]}`
        const maatDraaien = `${sizeRaw[2]}x${sizeRaw[1]}`

        for (const maatVariant of [maat, maatDraaien]) {
          const { data: product } = await supabase
            .from('producten')
            .select('artikelnr')
            .in('kwaliteit_code', kwaliteitCodes)
            .eq('kleur_code', kleur)
            .ilike('omschrijving', `%${maatVariant}%`)
            .limit(1)
          if (product && product.length > 0) {
            return { artikelnr: product[0].artikelnr, matchedOn: 'alias' }
          }
        }

        // Maat aanwezig maar geen standaard artikel → maatwerk
        return {
          artikelnr: null,
          matchedOn: 'maatwerk',
          is_maatwerk: true,
          maatwerk_kwaliteit_code: kwaliteitCodes[0],
          maatwerk_kleur_code: kleur,
        }
      }

      // Geen maat → eerste hit op kwaliteit + kleur
      const { data: product } = await supabase
        .from('producten')
        .select('artikelnr')
        .in('kwaliteit_code', kwaliteitCodes)
        .eq('kleur_code', kleur)
        .limit(1)
      if (product && product.length > 0) return { artikelnr: product[0].artikelnr, matchedOn: 'alias' }
    }
  }

  // Verzendkosten
  const titleBlob = `${row.productTitle ?? ''} ${row.variantTitle ?? ''}`
  if (VERZEND_PATROON.test(titleBlob)) {
    const { data } = await supabase
      .from('producten')
      .select('artikelnr')
      .eq('artikelnr', 'VERZEND')
      .limit(1)
    if (data && data.length > 0) return { artikelnr: 'VERZEND', matchedOn: 'verzend' }
  }

  const codes = uniekeCodes(row)

  // karpi_code match
  const karpiHit = await zoekOpKarpi(supabase, codes)
  if (karpiHit) return { artikelnr: karpiHit, matchedOn: 'karpi_code' }

  // artikelnr match
  if (codes.length > 0) {
    const { data } = await supabase
      .from('producten')
      .select('artikelnr')
      .in('artikelnr', codes)
      .limit(1)
    if (data && data.length > 0) return { artikelnr: data[0].artikelnr, matchedOn: 'artikelnr' }
  }

  // ean_code
  if (row.ean?.trim()) {
    const { data } = await supabase
      .from('producten')
      .select('artikelnr')
      .eq('ean_code', row.ean.trim())
      .limit(1)
    if (data && data.length > 0) return { artikelnr: data[0].artikelnr, matchedOn: 'ean' }
  }

  // Parse titel + variant → probeer karpi_code op te bouwen
  const parsedHit = await zoekViaParsing(supabase, row)
  if (parsedHit) return { artikelnr: parsedHit, matchedOn: 'parsed_karpi' }

  // omschrijving ilike (alleen unieke match)
  const titel = row.productTitle?.trim()
  if (titel) {
    const { data } = await supabase
      .from('producten')
      .select('artikelnr')
      .ilike('omschrijving', titel)
      .limit(2)
    if (data && data.length === 1) return { artikelnr: data[0].artikelnr, matchedOn: 'omschrijving' }
  }

  return { artikelnr: null, matchedOn: 'geen', unmatchedReden: classifyRow(row) }
}

export function buildOmschrijving(row: LightspeedOrderRow, match: ProductMatch): string {
  const base = [row.productTitle, row.variantTitle].filter(Boolean).join(' — ').trim()
  if (match.artikelnr || match.is_maatwerk) return base
  const prefix = (() => {
    switch (match.unmatchedReden) {
      case 'muster': return '[STAAL]'
      case 'wunschgrosse': return '[MAATWERK]'
      case 'durchmesser': return '[MAATWERK-ROND]'
      default: return '[UNMATCHED]'
    }
  })()
  return `${prefix} ${base || row.articleCode || row.sku || 'onbekend'}`
}
