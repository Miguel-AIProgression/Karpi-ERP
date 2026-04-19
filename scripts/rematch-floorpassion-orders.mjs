/**
 * Rematch alle Floorpassion webshop-regels met artikelnr=NULL tegen de
 * nieuwe matcher-logica (klanteigen_namen prefix-match + articleCode-fallback).
 *
 * Haalt per order opnieuw de Lightspeed-data op zodat we customFields
 * ("Afmeting: 280x360 (cm)") tot beschikking hebben. Werkt velden bij:
 *   artikelnr, is_maatwerk, maatwerk_lengte_cm/breedte_cm,
 *   maatwerk_kwaliteit_code/kleur_code, omschrijving-prefix.
 *
 * Gebruik:
 *   node scripts/rematch-floorpassion-orders.mjs [--dry-run]
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

for (const f of ['supabase/functions/.env', 'frontend/.env']) {
  const p = resolve(f)
  if (!existsSync(p)) continue
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    const key = m[1].startsWith('VITE_') ? m[1].slice(5) : m[1]
    if (!process.env[key]) process.env[key] = m[2]
    if (!process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRY_RUN = process.argv.includes('--dry-run')
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY verplicht')
  process.exit(1)
}

const sbHeaders = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
}

// ----------------------------------------------------------------------------
// Matcher-logica (spiegel van supabase/functions/_shared/product-matcher.ts)
// ----------------------------------------------------------------------------

const VERZEND_RE = /verzend|versand|shipping/i
const MUSTER_RE = /muster|sample|gratis\s+staal/i
const WUNSCH_RE = /wunschgr[öo]ß?e|op\s+maat|custom\s+size|volgens\s+tekening/i
const DURCH_RE = /durchmesser|diameter|rond\s+\d|rund\s+\d/i
const AFM_RE = /(\d+)\s*[xX×]\s*(\d+)/

function splitNaamKleur(title) {
  const t = (title ?? '').trim()
  const sepIdx = t.search(/\s[-–]\s/)
  const voor = sepIdx >= 0 ? t.slice(0, sepIdx).trim() : t
  const na = sepIdx >= 0 ? t.slice(sepIdx).replace(/^\s*[-–]\s*/, '').trim() : ''
  const voorMatch = voor.match(/^(.+?)\s+(\d{1,3})\s*$/)
  if (voorMatch) return { naam: voorMatch[1].trim(), kleur: voorMatch[2] }
  if (na) {
    const naMatch = na.match(/^(.+?)\s+(\d{1,3})(\s|$|,|cm)/)
    if (naMatch) return { naam: naMatch[1].trim(), kleur: naMatch[2] }
  }
  const anyMatch = t.match(/^(.+?)\s+(\d{1,3})(\s|$|-|,)/)
  if (anyMatch) return { naam: anyMatch[1].trim(), kleur: anyMatch[2] }
  return { naam: t, kleur: null }
}

function normaliseerNaam(s) {
  return (s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function matchAliases(naam, aliases) {
  const n = normaliseerNaam(naam)
  if (!n) return []
  return aliases
    .filter((a) => {
      const an = normaliseerNaam(a.benaming)
      if (!an) return false
      if (an === n) return true
      if (n.startsWith(an + ' ')) return true
      if (an.startsWith(n + ' ')) return true
      return false
    })
    .sort((a, b) => b.benaming.length - a.benaming.length)
}

function parseArticleCode(code) {
  if (!code) return { kwaliteit: null, kleur: null }
  const m = code.match(/^([A-Z]{2,6})(\d{1,3})/i)
  if (!m) return { kwaliteit: null, kleur: null }
  return { kwaliteit: m[1].toUpperCase(), kleur: m[2] }
}

function collectTexts(row) {
  const out = []
  for (const f of row.customFields ?? []) {
    for (const v of f.values ?? []) {
      if (v.value != null && typeof v.value === 'string') out.push(v.value)
    }
  }
  return out
}

function parseAfmeting(row) {
  const hay = [row.variantTitle, row.productTitle, ...collectTexts(row)].join(' ')
  const m = hay.match(AFM_RE)
  if (!m) return null
  return [parseInt(m[1], 10), parseInt(m[2], 10)]
}

function classify(row) {
  const hay = `${row.productTitle ?? ''} ${row.variantTitle ?? ''}`
  if (MUSTER_RE.test(hay)) return 'muster'
  if (WUNSCH_RE.test(hay)) return 'wunschgrosse'
  if (DURCH_RE.test(hay)) return 'durchmesser'
  return null
}

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { headers: sbHeaders })
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function zoekOpProductenKol(kol, waarden) {
  if (!waarden || waarden.length === 0) return null
  const vals = waarden.map(encodeURIComponent).join(',')
  const rows = await sbGet(`/rest/v1/producten?${kol}=in.(${vals})&select=artikelnr&limit=1`)
  return rows?.[0]?.artikelnr ?? null
}

async function matchProductInline(row, debiteurNr, aliases) {
  // Klanteigen_namen path
  if (debiteurNr && row.productTitle?.trim()) {
    const { naam, kleur: kUit } = splitNaamKleur(row.productTitle)
    const variantNum = row.variantTitle?.trim().match(/^\d{1,3}$/)?.[0] ?? null
    const kleur = kUit ?? variantNum ?? null
    const hits = matchAliases(naam, aliases)
    if (hits.length > 0 && kleur) {
      const kwaliteitCodes = hits.map((h) => h.kwaliteit_code)
      const afm = parseAfmeting(row)
      if (afm) {
        const [a, b] = afm
        const maten = [`${a}x${b}`, `${b}x${a}`]
        for (const m of maten) {
          const rs = await sbGet(
            `/rest/v1/producten?kwaliteit_code=in.(${kwaliteitCodes.join(',')})&kleur_code=eq.${kleur}&omschrijving=ilike.${encodeURIComponent('%' + m + '%')}&select=artikelnr&limit=1`,
          )
          if (rs?.length > 0) return { artikelnr: rs[0].artikelnr, matchedOn: 'alias' }
        }
        // Maat aanwezig, geen standaard artikel → maatwerk
        return {
          artikelnr: null, matchedOn: 'maatwerk', is_maatwerk: true,
          maatwerk_kwaliteit_code: kwaliteitCodes[0], maatwerk_kleur_code: kleur,
        }
      }
      // Geen maat → eerste hit op kwaliteit + kleur
      const rs = await sbGet(
        `/rest/v1/producten?kwaliteit_code=in.(${kwaliteitCodes.join(',')})&kleur_code=eq.${kleur}&select=artikelnr&limit=1`,
      )
      if (rs?.length > 0) return { artikelnr: rs[0].artikelnr, matchedOn: 'alias' }
    }
  }

  // Verzend
  const blob = `${row.productTitle ?? ''} ${row.variantTitle ?? ''}`
  if (VERZEND_RE.test(blob)) {
    const hit = await zoekOpProductenKol('artikelnr', ['VERZEND'])
    if (hit) return { artikelnr: 'VERZEND', matchedOn: 'verzend' }
  }

  // karpi_code / artikelnr / ean via codes
  const codes = [...new Set([row.articleCode, row.sku].filter(Boolean).map((s) => s.trim()).filter(Boolean))]
  const hitKarpi = await zoekOpProductenKol('karpi_code', codes)
  if (hitKarpi) return { artikelnr: hitKarpi, matchedOn: 'karpi_code' }
  if (codes.length > 0) {
    const hitArt = await zoekOpProductenKol('artikelnr', codes)
    if (hitArt) return { artikelnr: hitArt, matchedOn: 'artikelnr' }
  }
  if (row.ean?.trim()) {
    const hitEan = await zoekOpProductenKol('ean_code', [row.ean.trim()])
    if (hitEan) return { artikelnr: hitEan, matchedOn: 'ean' }
  }

  // Fallback: maatwerk-classificatie
  const reden = classify(row)
  if (reden === 'wunschgrosse' || reden === 'durchmesser') {
    const { naam, kleur: kUit } = splitNaamKleur(row.productTitle ?? '')
    const artcode = parseArticleCode(row.articleCode)
    let kwaliteit = artcode.kwaliteit
    if (debiteurNr) {
      const hits = matchAliases(naam, aliases)
      if (hits.length > 0) kwaliteit = hits[0].kwaliteit_code
    }
    return {
      artikelnr: null, matchedOn: 'maatwerk', is_maatwerk: true, unmatchedReden: reden,
      maatwerk_kwaliteit_code: kwaliteit, maatwerk_kleur_code: kUit ?? artcode.kleur,
    }
  }
  return { artikelnr: null, matchedOn: 'geen', unmatchedReden: reden }
}

function buildOmschrijving(row, match) {
  const base = [row.productTitle, row.variantTitle].filter(Boolean).join(' — ').trim()
  if (match.artikelnr || match.is_maatwerk) return base
  const prefix =
    match.unmatchedReden === 'muster' ? '[STAAL]' :
    match.unmatchedReden === 'wunschgrosse' ? '[MAATWERK]' :
    match.unmatchedReden === 'durchmesser' ? '[MAATWERK-ROND]' :
    '[UNMATCHED]'
  return `${prefix} ${base || row.articleCode || row.sku || 'onbekend'}`
}

// ----------------------------------------------------------------------------
// Lightspeed + DB ophalen
// ----------------------------------------------------------------------------

function lsCreds(bronShop) {
  const shop = bronShop === 'floorpassion_nl' ? 'NL' : bronShop === 'floorpassion_de' ? 'DE' : null
  if (!shop) return null
  const key = process.env[`LIGHTSPEED_${shop}_API_KEY`]
  const secret = process.env[`LIGHTSPEED_${shop}_API_SECRET`]
  const base = process.env[`LIGHTSPEED_${shop}_CLUSTER_URL`]
  if (!key || !secret || !base) return null
  return { auth: 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64'), base: base.replace(/\/$/, '') }
}

async function lsProducts(bronShop, bronOrderId) {
  const c = lsCreds(bronShop)
  if (!c) throw new Error(`Geen creds voor ${bronShop}`)
  const res = await fetch(`${c.base}/orders/${bronOrderId}/products.json`, {
    headers: { Authorization: c.auth, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`LS ${bronShop}/${bronOrderId}: ${res.status}`)
  return (await res.json()).orderProducts ?? []
}

async function updateRegel(id, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/order_regels?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`PATCH ${id}: ${res.status} ${await res.text()}`)
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`)

  // Alle unmatched regels op webshop-orders
  const regels = await sbGet(
    `/rest/v1/order_regels?artikelnr=is.null&select=id,order_id,regelnummer,omschrijving,omschrijving_2,is_maatwerk,maatwerk_kwaliteit_code,maatwerk_kleur_code,maatwerk_lengte_cm,maatwerk_breedte_cm`,
  )
  const orderIds = [...new Set(regels.map((r) => r.order_id))]
  const orders = await sbGet(
    `/rest/v1/orders?id=in.(${orderIds.join(',')})&bron_systeem=eq.lightspeed&select=id,order_nr,debiteur_nr,bron_shop,bron_order_id`,
  )
  const ordersById = new Map(orders.map((o) => [o.id, o]))
  const webshopRegels = regels.filter((r) => ordersById.has(r.order_id))
  console.log(`Unmatched webshop-regels: ${webshopRegels.length}`)

  // Alle aliases per debiteur (cachen)
  const aliasCache = new Map()
  async function getAliases(debiteurNr) {
    if (aliasCache.has(debiteurNr)) return aliasCache.get(debiteurNr)
    const rows = await sbGet(`/rest/v1/klanteigen_namen?debiteur_nr=eq.${debiteurNr}&select=benaming,kwaliteit_code`)
    aliasCache.set(debiteurNr, rows)
    return rows
  }

  const productsCache = new Map()
  const stats = { matched: 0, maatwerk: 0, staal: 0, nog_unmatched: 0, ongewijzigd: 0, error: 0 }

  for (const r of webshopRegels) {
    const o = ordersById.get(r.order_id)
    try {
      const cacheKey = `${o.bron_shop}:${o.bron_order_id}`
      let products = productsCache.get(cacheKey)
      if (!products) {
        products = await lsProducts(o.bron_shop, o.bron_order_id)
        productsCache.set(cacheKey, products)
        await new Promise((ok) => setTimeout(ok, 60))
      }
      let lsRow = products[r.regelnummer - 1] ?? null
      if (!lsRow) {
        const base = (r.omschrijving || '').replace(/^\[[A-Z-]+\]\s*/, '').split(' — ')[0]
        lsRow = products.find((p) => (p.productTitle ?? '').includes(base)) ?? null
      }
      if (!lsRow) {
        stats.error++
        console.warn(`  ${o.order_nr} regel ${r.regelnummer}: geen LS-product gematcht`)
        continue
      }

      const aliases = await getAliases(o.debiteur_nr)
      const m = await matchProductInline(lsRow, o.debiteur_nr, aliases)
      const nieuweOms = buildOmschrijving(lsRow, m)
      const afm = m.is_maatwerk ? parseAfmeting(lsRow) : null

      const patch = {
        artikelnr: m.artikelnr,
        omschrijving: nieuweOms,
        omschrijving_2: lsRow.variantTitle ?? null,
        is_maatwerk: m.is_maatwerk === true,
        maatwerk_kwaliteit_code: m.maatwerk_kwaliteit_code ?? null,
        maatwerk_kleur_code: m.maatwerk_kleur_code ?? null,
        maatwerk_lengte_cm: afm ? afm[0] : null,
        maatwerk_breedte_cm: afm ? afm[1] : null,
      }

      const zelfdeArt = (patch.artikelnr ?? null) === null && r.artikelnr == null
      const zelfdeOms = nieuweOms === r.omschrijving
      const zelfdeMW = patch.is_maatwerk === (r.is_maatwerk === true)
        && (patch.maatwerk_kwaliteit_code ?? null) === (r.maatwerk_kwaliteit_code ?? null)
        && (patch.maatwerk_lengte_cm ?? null) === (r.maatwerk_lengte_cm ?? null)
      if (zelfdeArt && zelfdeOms && zelfdeMW) {
        stats.ongewijzigd++
        continue
      }

      if (m.artikelnr) {
        stats.matched++
        console.log(`  [MATCH] ${o.order_nr} r${r.regelnummer}: → ${m.artikelnr} (${m.matchedOn})`)
      } else if (m.is_maatwerk) {
        stats.maatwerk++
        const dim = afm ? `${afm[0]}×${afm[1]}` : '?'
        console.log(`  [MW]    ${o.order_nr} r${r.regelnummer}: ${m.maatwerk_kwaliteit_code ?? '?'}-${m.maatwerk_kleur_code ?? '?'}  ${dim} cm`)
      } else if (m.unmatchedReden === 'muster') {
        stats.staal++
      } else {
        stats.nog_unmatched++
      }

      if (!DRY_RUN) await updateRegel(r.id, patch)
    } catch (err) {
      stats.error++
      console.error(`  ${o.order_nr} r${r.regelnummer}: ERROR ${err.message}`)
    }
  }

  console.log('\n=== SAMENVATTING ===')
  for (const [k, v] of Object.entries(stats)) if (v > 0) console.log(`  ${k}: ${v}`)
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
