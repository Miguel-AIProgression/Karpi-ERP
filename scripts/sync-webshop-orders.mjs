/**
 * Polling-sync van Lightspeed webshops → RugFlow.
 *
 * Draait stand-alone (geen edge function deploy nodig). Haalt per shop de
 * recent betaalde orders op (default: laatste 3 dagen), matcht producten,
 * en inserts via RPC `create_webshop_order`. De RPC is idempotent op
 * (bron_systeem, bron_order_id), dus herhaalde runs produceren geen
 * duplicates — je kunt dit rustig elke 5-10 min draaien.
 *
 * Env-vars (uit supabase/functions/.env + frontend/.env):
 *   SUPABASE_URL / VITE_SUPABASE_URL          (auto-geladen)
 *   SUPABASE_SERVICE_ROLE_KEY                 (auto-geladen)
 *   FLOORPASSION_DEBITEUR_NR                  (auto-geladen; default 99001)
 *   LIGHTSPEED_{NL,DE}_API_KEY/SECRET/CLUSTER_URL
 *
 * Optionele env-vars:
 *   LOOKBACK_DAYS=3                           hoever terug kijken (default 3)
 *   SHOP=nl|de                                beperk tot één shop
 *   WATCH=1                                   blijf draaien (elke INTERVAL_SEC)
 *   INTERVAL_SEC=300                          interval voor WATCH-mode (5 min)
 *   DRY_RUN=1                                 geen DB-insert, alleen loggen
 *
 * Gebruik:
 *   # Eenmalige run (nieuwe orders van afgelopen 3 dagen)
 *   node scripts/sync-webshop-orders.mjs
 *
 *   # Continu draaien (elke 5 min)
 *   WATCH=1 node scripts/sync-webshop-orders.mjs
 *
 *   # Alleen NL, 7 dagen terugkijken
 *   SHOP=nl LOOKBACK_DAYS=7 node scripts/sync-webshop-orders.mjs
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
const DEBITEUR_NR = Number(process.env.FLOORPASSION_DEBITEUR_NR ?? 260000)
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS ?? 3)
const SHOP_FILTER = process.env.SHOP ?? null
const WATCH = process.env.WATCH === '1'
const INTERVAL_SEC = Number(process.env.INTERVAL_SEC ?? 300)
const DRY_RUN = process.env.DRY_RUN === '1'

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Mist SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// -------------------------------------------------------------------
// Lightspeed client
// -------------------------------------------------------------------

function lightspeedClient(shop) {
  const suffix = shop.toUpperCase()
  const key = process.env[`LIGHTSPEED_${suffix}_API_KEY`]
  const secret = process.env[`LIGHTSPEED_${suffix}_API_SECRET`]
  const clusterRaw = process.env[`LIGHTSPEED_${suffix}_CLUSTER_URL`]
  if (!key || !secret || !clusterRaw) {
    throw new Error(`Shop ${shop}: ontbrekende credentials in env`)
  }
  const base = clusterRaw.replace(/\/$/, '')
  const auth = 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64')

  async function req(path) {
    const res = await fetch(`${base}${path}`, {
      headers: { Authorization: auth, Accept: 'application/json' },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '<no body>')
      throw new Error(`Lightspeed ${shop} ${res.status} @ ${path}: ${body.slice(0, 300)}`)
    }
    return res.json()
  }

  return {
    shop,
    listPaidOrders: (sinceISO) =>
      req(
        `/orders.json?paymentStatus=paid&createdAt_from=${encodeURIComponent(sinceISO)}&limit=250&sort=-createdAt`,
      ),
    getOrder: (id) => req(`/orders/${id}.json`).then((r) => r.order),
    getOrderProducts: (id) =>
      req(`/orders/${id}/products.json`).then((r) => r.orderProducts ?? []),
  }
}

// -------------------------------------------------------------------
// Supabase REST
// -------------------------------------------------------------------

async function supabaseRest(path, opts = {}) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
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
  if (!res.ok) throw new Error(`Supabase ${res.status} @ ${path}: ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : null
}

// -------------------------------------------------------------------
// Product matcher — gelijk aan supabase/functions/_shared/product-matcher.ts
// Pipeline: VERZEND → karpi_code → artikelnr → ean → parsed karpi_code → omschrijving
// -------------------------------------------------------------------

const VERZEND_RE = /verzend|versand|shipping/i
const MUSTER_RE = /muster|sample|gratis\s+staal/i
const WUNSCH_RE = /wunschgr[öo]ß?e|op\s+maat|custom\s+size|volgens\s+tekening/i
const DURCH_RE = /durchmesser|diameter|rond\s+\d|rund\s+\d/i
const AFM_RE = /(\d{2,3})\s*x\s*(\d{2,3})\s*cm/i

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

function classify(row) {
  const hay = `${row.productTitle ?? ''} ${row.variantTitle ?? ''}`
  if (MUSTER_RE.test(hay)) return 'muster'
  if (WUNSCH_RE.test(hay)) return 'wunschgrosse'
  if (DURCH_RE.test(hay)) return 'durchmesser'
  return null
}

async function tryCol(col, values) {
  for (const v of values) {
    const r = await supabaseRest(
      `/rest/v1/producten?${col}=eq.${encodeURIComponent(v)}&select=artikelnr&limit=1`,
    )
    if (r?.length > 0) return r[0].artikelnr
  }
  return null
}

async function zoekViaParsing(row) {
  const { basis, kleur } = parseTitel(row.productTitle ?? '')
  const afm = parseAfmeting(row.variantTitle) ?? parseAfmeting(row.productTitle)
  if (!basis || !kleur || !afm) return null
  const prefix = basis.replace(/\s+/g, '').slice(0, 4).toUpperCase()
  const kleurP = kleur.padStart(2, '0')
  const [a, b] = afm
  const aP = String(a).padStart(3, '0')
  const bP = String(b).padStart(3, '0')
  return tryCol('karpi_code', [`${prefix}${kleurP}XX${aP}${bP}`, `${prefix}${kleurP}XX${bP}${aP}`])
}

async function matchProduct(row) {
  const blob = `${row.productTitle ?? ''} ${row.variantTitle ?? ''}`
  if (VERZEND_RE.test(blob)) {
    const hit = await tryCol('artikelnr', ['VERZEND'])
    if (hit) return { artikelnr: hit, matchedOn: 'verzend' }
  }

  const codes = Array.from(
    new Set([row.articleCode, row.sku].map((v) => (v ?? '').trim()).filter(Boolean)),
  )
  if (codes.length > 0) {
    const hit = await tryCol('karpi_code', codes)
    if (hit) return { artikelnr: hit, matchedOn: 'karpi_code' }
  }
  if (codes.length > 0) {
    const hit = await tryCol('artikelnr', codes)
    if (hit) return { artikelnr: hit, matchedOn: 'artikelnr' }
  }
  if (row.ean?.trim()) {
    const hit = await tryCol('ean_code', [row.ean.trim()])
    if (hit) return { artikelnr: hit, matchedOn: 'ean' }
  }
  const parsed = await zoekViaParsing(row)
  if (parsed) return { artikelnr: parsed, matchedOn: 'parsed_karpi' }
  const naam = row.productTitle?.trim()
  if (naam) {
    const r = await supabaseRest(
      `/rest/v1/producten?omschrijving=ilike.${encodeURIComponent(naam)}&select=artikelnr&limit=2`,
    )
    if (r?.length === 1) return { artikelnr: r[0].artikelnr, matchedOn: 'omschrijving' }
  }
  return { artikelnr: null, matchedOn: 'geen', unmatchedReden: classify(row) }
}

function buildOmschrijving(row, match) {
  const base = [row.productTitle, row.variantTitle].filter(Boolean).join(' — ').trim()
  if (match.artikelnr) return base
  const prefix =
    match.unmatchedReden === 'muster'
      ? '[STAAL]'
      : match.unmatchedReden === 'wunschgrosse'
        ? '[MAATWERK]'
        : match.unmatchedReden === 'durchmesser'
          ? '[MAATWERK-ROND]'
          : '[UNMATCHED]'
  return `${prefix} ${base || row.articleCode || row.sku || 'onbekend'}`
}

// -------------------------------------------------------------------
// Adres-snapshots
// -------------------------------------------------------------------

function shipping(order) {
  const land = typeof order.addressShippingCountry === 'object'
    ? order.addressShippingCountry?.code ?? null
    : order.addressShippingCountry ?? null
  const straat = [order.addressShippingStreet, order.addressShippingNumber, order.addressShippingExtension]
    .filter(Boolean).join(' ').trim() || null
  return {
    afl_naam: order.addressShippingName ?? null,
    afl_naam_2: null,
    afl_adres: straat,
    afl_postcode: order.addressShippingZipcode ?? null,
    afl_plaats: order.addressShippingCity ?? null,
    afl_land: land,
  }
}

function billing(order) {
  const land = typeof order.addressBillingCountry === 'object'
    ? order.addressBillingCountry?.code ?? null
    : order.addressBillingCountry ?? null
  const straat = [order.addressBillingStreet, order.addressBillingNumber, order.addressBillingExtension]
    .filter(Boolean).join(' ').trim() || null
  return {
    fact_naam: order.addressBillingName ?? null,
    fact_adres: straat,
    fact_postcode: order.addressBillingZipcode ?? null,
    fact_plaats: order.addressBillingCity ?? null,
    fact_land: land,
  }
}

// -------------------------------------------------------------------
// Sync één shop
// -------------------------------------------------------------------

async function syncShop(shopCode, sinceISO) {
  const client = lightspeedClient(shopCode)
  const bronShop = shopCode === 'nl' ? 'floorpassion_nl' : 'floorpassion_de'

  const resp = await client.listPaidOrders(sinceISO)
  const orders = resp.orders ?? []

  const stats = { fetched: orders.length, created: 0, existing: 0, errors: 0, unmatched: 0 }

  for (const o of orders) {
    try {
      const [order, rows] = await Promise.all([client.getOrder(o.id), client.getOrderProducts(o.id)])

      const regels = []
      let unmatched = 0
      for (const row of rows) {
        const m = await matchProduct(row)
        if (!m.artikelnr) unmatched++
        const omschrijving = buildOmschrijving(row, m)
        const gewichtKg =
          row.weight != null && Number.isFinite(row.weight)
            ? Math.round((row.weight / 1_000_000) * 100) / 100
            : null
        regels.push({
          artikelnr: m.artikelnr,
          omschrijving,
          omschrijving_2: row.variantTitle ?? null,
          orderaantal: row.quantityOrdered ?? 1,
          te_leveren: row.quantityOrdered ?? 1,
          prijs: row.priceIncl ?? null,
          korting_pct: 0,
          bedrag: (row.priceIncl ?? 0) * (row.quantityOrdered ?? 1),
          gewicht_kg: gewichtKg,
        })
      }
      stats.unmatched += unmatched

      const header = {
        debiteur_nr: DEBITEUR_NR,
        klant_referentie: `Floorpassion #${order.number}`,
        orderdatum: order.createdAt ? order.createdAt.slice(0, 10) : null,
        afleverdatum: null,
        ...shipping(order),
        ...billing(order),
        bron_systeem: 'lightspeed',
        bron_shop: bronShop,
        bron_order_id: String(order.id),
      }

      if (DRY_RUN) {
        console.log(
          `  [dry] ${shopCode} #${order.number} — ${regels.length} regels (${unmatched} unmatched)`,
        )
        continue
      }

      const rpc = await supabaseRest('/rest/v1/rpc/create_webshop_order', {
        method: 'POST',
        body: JSON.stringify({ p_header: header, p_regels: regels }),
      })
      const r = Array.isArray(rpc) ? rpc[0] : rpc
      if (r?.was_existing) {
        stats.existing++
      } else {
        stats.created++
        console.log(
          `  [${shopCode}] + ${r?.order_nr} ← #${order.number} (${regels.length} regels, ${unmatched} unmatched)`,
        )
      }
    } catch (err) {
      stats.errors++
      console.error(`  [${shopCode}] FOUT op Lightspeed order ${o.id}:`, err.message)
    }
  }

  return stats
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------

async function runOnce() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString()
  const shops = SHOP_FILTER ? [SHOP_FILTER] : ['nl', 'de']
  const started = new Date().toISOString()
  console.log(`[${started}] sync — since=${since} shops=${shops.join(',')} dry=${DRY_RUN}`)

  for (const shop of shops) {
    try {
      const s = await syncShop(shop, since)
      console.log(
        `  [${shop}] fetched=${s.fetched} created=${s.created} existing=${s.existing} errors=${s.errors} unmatched=${s.unmatched}`,
      )
    } catch (err) {
      console.error(`  [${shop}] FATAL:`, err.message)
    }
  }
}

if (WATCH) {
  console.log(`WATCH-mode: elke ${INTERVAL_SEC}s`)
  while (true) {
    try {
      await runOnce()
    } catch (err) {
      console.error('run failed:', err.message)
    }
    await new Promise((r) => setTimeout(r, INTERVAL_SEC * 1000))
  }
} else {
  await runOnce()
}
