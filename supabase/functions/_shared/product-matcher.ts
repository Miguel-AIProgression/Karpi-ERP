// Mapping webshop-orderregel → RugFlow `producten.artikelnr`.
//
// Strategie (eerste hit wint):
//   Als debiteurNr opgegeven → klanteigen_namen EERST (naam+kleur parsen):
//     a. maat aanwezig + niet-rechthoekige vorm (organisch/ovaal/rond) → maatwerk
//        maat aanwezig + rechthoekig → zoek standaard artikel (ook gedraaid: 200x250 = 250x200)
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
import { collectExtraTexts, parseMaatwerkDims, type LightspeedOrderRow } from './lightspeed-client.ts'
import { normaliseerNaam } from './debiteur-matcher.ts'

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
  maatwerk_vorm?: string | null
}

const VERZEND_PATROON = /verzend|versand|shipping/i
const MUSTER_PATROON = /muster|sample|gratis\s+staal/i
// `\bcustom\b` (los woord) vangt ook Shopify's maatwerk-app-variantnamen als
// "Rechthoek / Custom" — daar ontbreken de afmetingen in deze regel zelf
// (vermoedelijk een datalek bij het plaatsen van de order), maar het label
// "Custom" alleen is al een hard signaal: nooit aan een vaste-maat artikel
// koppelen, altijd als maatwerk-zonder-dims wegzetten (backfill vult later aan).
const WUNSCHGROSSE_PATROON = /wunschgr[öo]ß?e|op\s+maat|volgens\s+tekening|\bcustom\b/i
const DURCHMESSER_PATROON = /durchmesser|diameter|rond\s+\d|rund\s+\d/i
const AFMETING_PATROON = /(\d{2,3})\s*x\s*(\d{2,3})\s*cm/i
const OVAAL_PATROON = /ovaal|oval/i

// Cache van actieve vormen (m.u.v. 'rechthoek', dat is de default — geen
// "afwijkende vorm"-signaal). Vormen wijzigen zelden; één keer per cold-start
// ophalen is ruim voldoende en voorkomt een DB-call per orderregel.
let vormenCache: Array<{ code: string; naam: string }> | null = null

async function laadAfwijkendeVormen(
  supabase: SupabaseClient,
): Promise<Array<{ code: string; naam: string }>> {
  if (vormenCache) return vormenCache
  const { data, error } = await supabase
    .from('maatwerk_vormen')
    .select('code, naam')
    .eq('actief', true)
    .neq('code', 'rechthoek')
  if (error) console.error('[product-matcher] laadAfwijkendeVormen:', error.message)
  vormenCache = (data ?? []) as Array<{ code: string; naam: string }>
  return vormenCache
}

/**
 * Detecteert een niet-rechthoekige vorm in de orderregeltekst → altijd
 * maatwerk, nooit koppelen aan een standaard (rechthoekig) artikel.
 *
 * Matcht tegen `maatwerk_vormen.naam` — DE bron-van-waarheid voor vormnamen,
 * en precies de Engelse benamingen ("Organic", "Organic Gespiegeld", "Pebble",
 * "Ellips", "Afgeronde Hoeken", "Cloud") die zowel operators als Shopify-/
 * mailorders gebruiken. Eerder hardcoded regex (`/organisch[e]?/`) miste
 * "Organic" volledig (andere spelling) en kende alleen organisch_a/ovaal/rond
 * — vier van de negen actieve vormen werden nooit herkend.
 *
 * Langste naam eerst zodat "Organic Gespiegeld" wint van "Organic" (anders
 * matcht de generieke substring eerder en krijgt het stuk de verkeerde toeslag
 * en spiegel-instructie mee het snijplan in).
 *
 * Fallback op vaste rond/ovaal-patronen voor spellingen die niet 1-op-1 in
 * `maatwerk_vormen.naam` staan (Duits "Durchmesser"/"rund", Engels "oval").
 */
async function detectVorm(supabase: SupabaseClient, text: string): Promise<string | null> {
  const tNorm = normaliseerNaam(text)
  if (!tNorm) return null

  const vormen = await laadAfwijkendeVormen(supabase)
  const sorted = [...vormen].sort((a, b) => b.naam.length - a.naam.length)
  for (const v of sorted) {
    const vNorm = normaliseerNaam(v.naam)
    if (vNorm && tNorm.includes(vNorm)) return v.code
  }

  if (OVAAL_PATROON.test(text)) return 'ovaal'
  if (DURCHMESSER_PATROON.test(text)) return 'rond'
  return null
}

function uniekeCodes(row: LightspeedOrderRow): string[] {
  const set = new Set<string>()
  for (const v of [row.articleCode, row.sku]) {
    const t = v?.trim()
    if (t) set.add(t)
  }
  return Array.from(set)
}

// Parse "naam + kleur" uit Lightspeed productTitle. Floorpassion hanteert
// twee patronen:
//   "Ross 63 - Hochflor Teppich"                      → { naam:"Ross", kleur:"63" }
//   "Fay Soft Beige 13 - Zacht vloerkleed"            → { naam:"Fay Soft Beige", kleur:"13" }
//   "Weicher Einfarbiger Teppich - Frisco 21"         → { naam:"Frisco", kleur:"21" }
//   "Einfarbiger Teppich in organischer Form - Lunar 21" → { naam:"Lunar", kleur:"21" }
// Strategie: check eerst VOOR " - " op "X Y Z NN"-formaat; zo niet, check NA " - ".
function splitNaamKleur(title: string): { naam: string; kleur: string | null } {
  const t = title.trim()
  const sepIdx = t.search(/\s[-–]\s/)
  const voor = sepIdx >= 0 ? t.slice(0, sepIdx).trim() : t
  const na = sepIdx >= 0 ? t.slice(sepIdx).replace(/^\s*[-–]\s*/, '').trim() : ''

  const voorMatch = voor.match(/^(.+?)\s+(\d{1,3})\s*$/)
  if (voorMatch) return { naam: voorMatch[1].trim(), kleur: voorMatch[2] }

  if (na) {
    const naMatch = na.match(/^(.+?)\s+(\d{1,3})(\s|$|,|cm)/)
    if (naMatch) return { naam: naMatch[1].trim(), kleur: naMatch[2] }
  }

  // Fallback: hele titel, eerste naam+nummer combinatie.
  const anyMatch = t.match(/^(.+?)\s+(\d{1,3})(\s|$|-|,)/)
  if (anyMatch) return { naam: anyMatch[1].trim(), kleur: anyMatch[2] }
  return { naam: t, kleur: null }
}

/** Vind aliases waarvan de benaming een prefix van `naam` is (of vice versa),
 *  case-insensitive en diacritics-safe. "FAY" ↔ "Fay Soft Beige" matcht. */
function matchAliasesViaPrefix(
  naam: string,
  aliases: Array<{ benaming: string; kwaliteit_code: string }>,
): Array<{ benaming: string; kwaliteit_code: string }> {
  const nNorm = normaliseerNaam(naam)
  if (!nNorm) return []
  return aliases
    .filter((a) => {
      const aNorm = normaliseerNaam(a.benaming)
      if (!aNorm) return false
      if (aNorm === nNorm) return true
      // Alias-benaming is prefix van productnaam ("FAY" ⊂ "fay soft beige")
      if (nNorm.startsWith(aNorm + ' ')) return true
      // Andersom: productnaam is prefix van alias ("Ross" ⊂ "ROSS DELUXE")
      if (aNorm.startsWith(nNorm + ' ')) return true
      return false
    })
    // Langste alias-match eerst (meer specifiek wint)
    .sort((a, b) => b.benaming.length - a.benaming.length)
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

/**
 * Parse kwaliteit + kleur uit Lightspeed `articleCode`.
 * Floorpassion hanteert `{KWALITEIT}{KLEUR}{SIZE|MAATWERK}` — bv.
 *   "PLUS13MAATWERK" → { kwaliteit: "PLUS", kleur: "13" }
 *   "GALA14XX140200" → { kwaliteit: "GALA", kleur: "14" }
 * Gebruikt als fallback voor maatwerk-artikelen zonder alias-match.
 */
function parseArticleCode(code: string | null | undefined): { kwaliteit: string | null; kleur: string | null } {
  if (!code) return { kwaliteit: null, kleur: null }
  const m = code.match(/^([A-Z]{2,6})(\d{1,3})/i)
  if (!m) return { kwaliteit: null, kleur: null }
  return { kwaliteit: m[1].toUpperCase(), kleur: m[2] }
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

/**
 * Vind het generieke maatwerk-artikel voor een kwaliteit+kleur. Karpi-conventie:
 * de omschrijving is `{KWALITEIT}{KLEUR}MAATWERK` (bv. "LAGO19MAATWERK" →
 * artikelnr 553199998). Gebruikt zodat maatwerk-regels toch aan een product
 * hangen voor voorraad/facturatie, terwijl is_maatwerk=true + maatwerk-dims
 * de uniekheid bewaren.
 */
async function zoekMaatwerkProduct(
  supabase: SupabaseClient,
  kwaliteit: string,
  kleur: string,
): Promise<string | null> {
  const pattern = `${kwaliteit}${kleur}MAATWERK`
  const { data } = await supabase
    .from('producten')
    .select('artikelnr')
    .ilike('omschrijving', pattern)
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

  // Muster/staaltjes VROEG detecteren — deze regels worden upstream
  // (sync-webshop-order + import-lightspeed-orders) overgeslagen omdat Karpi
  // geen staaltjes factureert aan Floorpassion (altijd gratis). De caller
  // gebruikt `unmatchedReden === 'muster'` als skip-signaal.
  const musterBlob = `${row.productTitle ?? ''} ${row.variantTitle ?? ''}`
  if (MUSTER_PATROON.test(musterBlob)) {
    return { artikelnr: null, matchedOn: 'geen', unmatchedReden: 'muster' }
  }

  // Klanteigen_namen EERST als debiteurNr bekend is — naam+kleur parsen heeft prioriteit
  // over code-matching zodat maatwerk-artikelen correct herkend worden.
  // We halen ALLE aliases voor de debiteur in één query en matchen in-memory
  // met prefix-regels (zodat "FAY" matcht op "Fay Soft Beige" en "Brüssel"
  // op "BRUSSEL" dankzij diacritics-normalisatie).
  if (debiteurNr && row.productTitle?.trim()) {
    const { naam, kleur: kleurUitTitel } = splitNaamKleur(row.productTitle)
    // Kleur moet numeriek zijn. variantTitle bevat vaak "Op maat" / "Wunschgröße"
    // — die mag NIET als kleur doorschuiven anders zoekt de producten-query op
    // een tekst-string en maakt maatwerk-records met kleur "Wunschgröße".
    const variantNumeriek = row.variantTitle?.trim().match(/^\d{1,3}$/)?.[0] ?? null
    const kleur = kleurUitTitel ?? variantNumeriek ?? null

    // Expliciet maatwerk-signaal: "Op maat" / "Wunschgröße" / "Custom size".
    // Deze regels moeten ALTIJD maatwerk worden, óók als de dims toevallig
    // overeenkomen met een standaard artikel (klant heeft bewust "Op maat"
    // gekozen, dat is een snijplan-opdracht). Nooit doorvallen naar
    // "eerste hit op kwaliteit+kleur" want dat matcht willekeurig.
    const titleBlobEarly = `${row.productTitle ?? ''} ${row.variantTitle ?? ''}`
    const isExplicietMaatwerk = WUNSCHGROSSE_PATROON.test(titleBlobEarly) || DURCHMESSER_PATROON.test(titleBlobEarly)

    const { data: aliasRows } = await supabase
      .from('klanteigen_namen')
      .select('benaming, kwaliteit_code')
      .eq('debiteur_nr', debiteurNr)

    const aliases = matchAliasesViaPrefix(naam, (aliasRows ?? []) as Array<{ benaming: string; kwaliteit_code: string }>)

    if (aliases.length > 0 && kleur) {
      let kwaliteitCodes = aliases.map((a) => a.kwaliteit_code)

      // Expliciete Karpi-code (SKU/articleCode) is autoritatief — bronsystemen
      // (Shopify, Lightspeed) sturen de Karpi-productcode altijd mee, bv. SKU
      // "LAGO13XXMAATWERK" → kwaliteit LAGO, kleur 13. Die weegt zwaarder dan
      // een fuzzy naam-alias-gok: "Lago 13" matchte ooit ten onrechte op
      // klant-alias "LAGO SISAL" (→ ZONK), terwijl kleur 13 binnen ZONK niet
      // eens bestaat — en LAGO13(XX...)/LAGO13MAATWERK gewoon bestaan. Alleen
      // vóórvoegen als de geparste kwaliteit ook echt bestaat, anders kan een
      // willekeurige SKU-prefix de terechte fuzzy match onterecht verdringen.
      const artcodeEarly = parseArticleCode(row.articleCode)
      if (artcodeEarly.kwaliteit && !kwaliteitCodes.includes(artcodeEarly.kwaliteit)) {
        const { data: kwalRow } = await supabase
          .from('kwaliteiten')
          .select('code')
          .eq('code', artcodeEarly.kwaliteit)
          .limit(1)
        if (kwalRow && kwalRow.length > 0) {
          kwaliteitCodes = [artcodeEarly.kwaliteit, ...kwaliteitCodes]
        }
      }

      // Maat uit variantTitle, productTitle, articleCode én customFields (rechthoek + rond)
      const dims = parseMaatwerkDims(row)
      const sizeRaw = dims ? [String(dims.lengte), String(dims.breedte)] as [string, string] : null

      // Bij expliciet maatwerk ALTIJD maatwerk-record (afmeting kan ontbreken
      // als customFields tijdelijk niet binnenkwamen — dan is_maatwerk=true
      // met lege dims en backfill-script vult later aan).
      if (isExplicietMaatwerk) {
        // Kwaliteit disambiguïtieit: als meerdere aliases bestaan voor dezelfde
        // benaming (bijv. ROSS → GLAM/LAGO/LAMI/…), geeft articleCode de
        // definitieve keuze aan. "LAGO19MAATWERK" → LAGO. Val terug op aliases[0]
        // als articleCode geen geldige alias aanwijst.
        const artcode = parseArticleCode(row.articleCode)
        const gekozenKwaliteit = artcode.kwaliteit && kwaliteitCodes.includes(artcode.kwaliteit)
          ? artcode.kwaliteit
          : kwaliteitCodes[0]
        // Koppel aan generiek maatwerk-artikel `{KWALITEIT}{KLEUR}MAATWERK`
        // zodat voorraad/facturatie een artikelnr heeft; dims zitten in
        // maatwerk_lengte/breedte_cm.
        const maatwerkArtikelnr = await zoekMaatwerkProduct(supabase, gekozenKwaliteit, kleur)
        return {
          artikelnr: maatwerkArtikelnr,
          matchedOn: 'maatwerk',
          unmatchedReden: DURCHMESSER_PATROON.test(titleBlobEarly) ? 'durchmesser' : 'wunschgrosse',
          is_maatwerk: true,
          maatwerk_kwaliteit_code: gekozenKwaliteit,
          maatwerk_kleur_code: kleur,
        }
      }

      if (sizeRaw) {
        // Niet-rechthoekige vorm → altijd maatwerk, nooit koppelen aan standaard artikel.
        const fullText = [row.productTitle, row.variantTitle, ...collectExtraTexts(row)].join(' ')
        const vorm = await detectVorm(supabase, fullText)
        if (vorm) {
          return {
            artikelnr: null,
            matchedOn: 'maatwerk',
            is_maatwerk: true,
            maatwerk_kwaliteit_code: kwaliteitCodes[0],
            maatwerk_kleur_code: kleur,
            maatwerk_vorm: vorm,
          }
        }

        const maat        = `${sizeRaw[0]}x${sizeRaw[1]}`
        const maatDraaien = `${sizeRaw[1]}x${sizeRaw[0]}`

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

        // Probeer karpi_code opbouw: {KWALITEIT}{KLEUR}XX{A}{B} (bijv. LUXR17XX160230).
        // Vaste-maat artikelen hebben geen 'x' in omschrijving; karpi_code is de bron.
        const kleurP2 = String(kleur).padStart(2, '0')
        const a0 = String(sizeRaw[0]).padStart(3, '0')
        const a1 = String(sizeRaw[1]).padStart(3, '0')
        for (const kwal of kwaliteitCodes) {
          const karpiHit = await zoekOpKarpi(supabase, [
            `${kwal}${kleurP2}XX${a0}${a1}`,
            `${kwal}${kleurP2}XX${a1}${a0}`,
          ])
          if (karpiHit) return { artikelnr: karpiHit, matchedOn: 'parsed_karpi' }
        }

        // Maat aanwezig maar geen standaard artikel → maatwerk
        const artcode2 = parseArticleCode(row.articleCode)
        const gekozenKwaliteit2 = artcode2.kwaliteit && kwaliteitCodes.includes(artcode2.kwaliteit)
          ? artcode2.kwaliteit
          : kwaliteitCodes[0]
        const maatwerkArtikelnr2 = await zoekMaatwerkProduct(supabase, gekozenKwaliteit2, kleur)
        return {
          artikelnr: maatwerkArtikelnr2,
          matchedOn: 'maatwerk',
          is_maatwerk: true,
          maatwerk_kwaliteit_code: gekozenKwaliteit2,
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

  // Fallback voor maatwerk zonder artikel-match: is_maatwerk vlag zetten
  // zodat sync-webshop-order de afmeting uitleest + kwaliteit/kleur afleiden.
  // Bron-volgorde: alias uit klanteigen_namen → articleCode (bv. "PLUS13MAATWERK").
  // Kleur bij voorkeur uit productTitle, anders uit articleCode-tail.
  const unmatchedReden = classifyRow(row)
  if (unmatchedReden === 'wunschgrosse' || unmatchedReden === 'durchmesser') {
    const { naam, kleur: kleurUitTitel } = splitNaamKleur(row.productTitle ?? '')
    const artcode = parseArticleCode(row.articleCode)
    let kwaliteit: string | null = artcode.kwaliteit
    if (debiteurNr) {
      const { data: aliasRows } = await supabase
        .from('klanteigen_namen')
        .select('benaming, kwaliteit_code')
        .eq('debiteur_nr', debiteurNr)
      const hits = matchAliasesViaPrefix(naam, (aliasRows ?? []) as Array<{ benaming: string; kwaliteit_code: string }>)
      if (hits.length > 0) kwaliteit = hits[0].kwaliteit_code
    }
    const finaleKleur = kleurUitTitel ?? artcode.kleur
    const maatwerkArtikelnr3 = kwaliteit && finaleKleur
      ? await zoekMaatwerkProduct(supabase, kwaliteit, finaleKleur)
      : null
    return {
      artikelnr: maatwerkArtikelnr3,
      matchedOn: 'maatwerk',
      unmatchedReden,
      is_maatwerk: true,
      maatwerk_kwaliteit_code: kwaliteit,
      maatwerk_kleur_code: finaleKleur,
    }
  }
  return { artikelnr: null, matchedOn: 'geen', unmatchedReden }
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
