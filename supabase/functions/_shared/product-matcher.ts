// Mapping webshop-orderregel → RugFlow producten.artikelnr.
//
// Strategie (eerste hit wint):
//   Als debiteurNr opgegeven → klanteigen_namen EERST (naam+kleur parsen):
//     a. maat aanwezig → zoek standaard artikel (ook gedraaid: 200x250 = 250x200)
//        gevonden → artikelnr; niet gevonden → maatwerk
//     b. geen maat → eerste hit op kwaliteit + kleur
//   Daarna fallback op codes (alleen als geen alias gevonden):
//   1. articleCode / sku → producten.karpi_code
//   2. articleCode / sku → producten.artikelnr
//   3. ean_code match
//   4. productTitle exact match op producten.omschrijving (alleen unieke hit)

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { collectExtraTexts, type LightspeedOrderRow } from './lightspeed-client.ts'

export type MatchBron = 'karpi_code' | 'artikelnr' | 'ean' | 'alias' | 'omschrijving' | 'maatwerk' | 'geen'

export interface ProductMatch {
  artikelnr: string | null
  matchedOn: MatchBron
  is_maatwerk?: boolean
  maatwerk_kwaliteit_code?: string | null
  maatwerk_kleur_code?: string | null
}

function uniekeCodes(row: LightspeedOrderRow): string[] {
  const set = new Set<string>()
  for (const v of [row.articleCode, row.sku]) {
    const t = v?.trim()
    if (t) set.add(t)
  }
  return Array.from(set)
}

// Splitst "Ross 63 - Hochflor Teppich" → { naam: "Ross", kleur: "63" }
// Strategie: eerste getal in de titel = kleur, alles ervóór = productnaam
function splitNaamKleur(title: string): { naam: string; kleur: string | null } {
  const match = title.trim().match(/^(.+?)\s+(\d+)(\s|$|-|,)/)
  if (match) {
    return { naam: match[1].trim(), kleur: match[2] }
  }
  return { naam: title.trim(), kleur: null }
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

  // Fallback: code-matching (karpi_code, artikelnr, ean)
  const codes = uniekeCodes(row)

  if (codes.length > 0) {
    const { data } = await supabase
      .from('producten')
      .select('artikelnr')
      .in('karpi_code', codes)
      .limit(1)
    if (data && data.length > 0) return { artikelnr: data[0].artikelnr, matchedOn: 'karpi_code' }
  }

  if (codes.length > 0) {
    const { data } = await supabase
      .from('producten')
      .select('artikelnr')
      .in('artikelnr', codes)
      .limit(1)
    if (data && data.length > 0) return { artikelnr: data[0].artikelnr, matchedOn: 'artikelnr' }
  }

  if (row.ean?.trim()) {
    const { data } = await supabase
      .from('producten')
      .select('artikelnr')
      .eq('ean_code', row.ean.trim())
      .limit(1)
    if (data && data.length > 0) return { artikelnr: data[0].artikelnr, matchedOn: 'ean' }
  }

  // Omschrijving exact (case-insensitive) — alleen unieke match
  const titel = row.productTitle?.trim()
  if (titel) {
    const { data } = await supabase
      .from('producten')
      .select('artikelnr')
      .ilike('omschrijving', titel)
      .limit(2)
    if (data && data.length === 1) return { artikelnr: data[0].artikelnr, matchedOn: 'omschrijving' }
  }

  return { artikelnr: null, matchedOn: 'geen' }
}
