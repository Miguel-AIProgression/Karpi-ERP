/**
 * Hermatchen van bestaande order_regels zonder artikelnr op webshop-orders.
 *
 * Past de nieuwe matcher-logica (uit supabase/functions/_shared/product-matcher.ts)
 * toe op regels waar artikelnr=NULL en order.bron_systeem='lightspeed'. Updatet
 * alleen rijen waar we nu wél een match kunnen leggen — laat echte [UNMATCHED]
 * regels met rust zodat handmatige review blijft werken.
 *
 * Gebruik:
 *   DRY_RUN=1 node scripts/rematch-unmatched-webshop-regels.mjs   # preview
 *   node scripts/rematch-unmatched-webshop-regels.mjs             # apply
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadEnv(path) {
  try {
    const content = readFileSync(path, 'utf8')
    for (const line of content.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i < 0) continue
      const k = t.slice(0, i).trim()
      const v = t.slice(i + 1).trim()
      if (!process.env[k]) process.env[k] = v
    }
  } catch {
    /* ignore */
  }
}
loadEnv(resolve(__dirname, '../supabase/functions/.env'))
loadEnv(resolve(__dirname, '../frontend/.env'))

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRY_RUN = process.env.DRY_RUN === '1'

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Mist SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(opts.headers ?? {}),
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} @ ${path}: ${text.slice(0, 400)}`)
  return text ? JSON.parse(text) : null
}

// -------------------------------------------------------------------
// Matcher-regels (spiegelt supabase/functions/_shared/product-matcher.ts).
// Input hier is een order_regel (omschrijving + omschrijving_2), dus we
// reconstrueren productTitle / variantTitle uit de omschrijving.
// -------------------------------------------------------------------

const VERZEND_RE = /verzend|versand|shipping/i
const MUSTER_RE = /muster|sample|gratis\s+staal/i
const WUNSCH_RE = /wunschgr[öo]ß?e|op\s+maat|custom\s+size|volgens\s+tekening/i
const DURCH_RE = /durchmesser|diameter|rond\s+\d|rund\s+\d/i
const AFM_RE = /(\d{2,3})\s*x\s*(\d{2,3})\s*cm/i

function parseFromRegel(regel) {
  // omschrijving vorm: "[UNMATCHED] Firenze 12 - Niederflorteppich — 130x190 cm"
  //   of:              "Firenze 12 - Niederflorteppich — 130x190 cm" (zelden)
  let clean = (regel.omschrijving || '').replace(/^\[[A-Z-]+\]\s*/, '').trim()
  let productTitle = clean
  let variantTitle = regel.omschrijving_2 ?? null
  const sep = clean.indexOf(' — ')
  if (sep > 0) {
    productTitle = clean.slice(0, sep).trim()
    if (!variantTitle) variantTitle = clean.slice(sep + 3).trim()
  }
  return { productTitle, variantTitle }
}

function parseTitel(t) {
  const clean = (t || '').replace(/\s*-.*$/, '').trim()
  const m = clean.match(/^(.+?)\s+(\d{1,3})\s*$/)
  if (m) return { basis: m[1].trim(), kleur: m[2] }
  return { basis: clean, kleur: null }
}

function parseAfmeting(t) {
  if (!t) return null
  const m = t.match(AFM_RE)
  if (!m) return null
  return [Number(m[1]), Number(m[2])]
}

function classify(pt, vt) {
  const hay = `${pt ?? ''} ${vt ?? ''}`
  if (MUSTER_RE.test(hay)) return 'muster'
  if (WUNSCH_RE.test(hay)) return 'wunschgrosse'
  if (DURCH_RE.test(hay)) return 'durchmesser'
  return null
}

async function tryCol(col, values) {
  for (const v of values) {
    const r = await sb(
      `/rest/v1/producten?${col}=eq.${encodeURIComponent(v)}&select=artikelnr&limit=1`,
    )
    if (r?.length > 0) return r[0].artikelnr
  }
  return null
}

async function zoekViaParsing(pt, vt) {
  const { basis, kleur } = parseTitel(pt)
  const afm = parseAfmeting(vt) ?? parseAfmeting(pt)
  if (!basis || !kleur || !afm) return null
  const prefix = basis.replace(/\s+/g, '').slice(0, 4).toUpperCase()
  const kleurP = kleur.padStart(2, '0')
  const [a, b] = afm
  const aP = String(a).padStart(3, '0')
  const bP = String(b).padStart(3, '0')
  return tryCol('karpi_code', [`${prefix}${kleurP}XX${aP}${bP}`, `${prefix}${kleurP}XX${bP}${aP}`])
}

async function match(regel) {
  const { productTitle, variantTitle } = parseFromRegel(regel)
  const blob = `${productTitle ?? ''} ${variantTitle ?? ''}`
  if (VERZEND_RE.test(blob)) {
    const hit = await tryCol('artikelnr', ['VERZEND'])
    if (hit) return { artikelnr: hit, matchedOn: 'verzend', productTitle, variantTitle }
  }
  const parsed = await zoekViaParsing(productTitle, variantTitle)
  if (parsed) return { artikelnr: parsed, matchedOn: 'parsed_karpi', productTitle, variantTitle }
  return {
    artikelnr: null,
    matchedOn: 'geen',
    unmatchedReden: classify(productTitle, variantTitle),
    productTitle,
    variantTitle,
  }
}

function niewOmschrijving(productTitle, variantTitle, matchResult) {
  const base = [productTitle, variantTitle].filter(Boolean).join(' — ').trim()
  if (matchResult.artikelnr) return base
  const prefix =
    matchResult.unmatchedReden === 'muster'
      ? '[STAAL]'
      : matchResult.unmatchedReden === 'wunschgrosse'
        ? '[MAATWERK]'
        : matchResult.unmatchedReden === 'durchmesser'
          ? '[MAATWERK-ROND]'
          : '[UNMATCHED]'
  return `${prefix} ${base}`
}

async function run() {
  console.log(`Ophalen unmatched regels (dry=${DRY_RUN})...`)
  const regels = await sb(
    `/rest/v1/order_regels?select=id,order_id,omschrijving,omschrijving_2&artikelnr=is.null&limit=500`,
  )
  // Filter op webshop-orders
  const orderIds = Array.from(new Set(regels.map((r) => r.order_id)))
  const orders = await sb(
    `/rest/v1/orders?id=in.(${orderIds.join(',')})&bron_systeem=eq.lightspeed&select=id`,
  )
  const webshopOrderIds = new Set(orders.map((o) => o.id))
  const webshopRegels = regels.filter((r) => webshopOrderIds.has(r.order_id))

  console.log(`Totaal unmatched op webshop-orders: ${webshopRegels.length}`)

  const stats = { matched_nieuw: 0, prefix_gewijzigd: 0, ongewijzigd: 0 }

  for (const r of webshopRegels) {
    const result = await match(r)
    const nieuweOms = niewOmschrijving(result.productTitle, result.variantTitle, result)
    const nieuweArt = result.artikelnr

    const zelfdePrefix = nieuweOms === r.omschrijving
    const geenArtChange = !nieuweArt
    if (zelfdePrefix && geenArtChange) {
      stats.ongewijzigd++
      continue
    }

    if (nieuweArt) {
      stats.matched_nieuw++
      console.log(`  [MATCH] id=${r.id} → ${nieuweArt} (${result.matchedOn})`)
    } else {
      stats.prefix_gewijzigd++
      console.log(`  [PREFIX] id=${r.id}: "${r.omschrijving}" → "${nieuweOms}"`)
    }

    if (DRY_RUN) continue
    await sb(`/rest/v1/order_regels?id=eq.${r.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ artikelnr: nieuweArt, omschrijving: nieuweOms }),
    })
  }

  console.log(`\nResultaat: ${JSON.stringify(stats)}`)
}

await run()
