/**
 * End-to-end integration test — DRAAIT LOKAAL ZONDER EDGE FUNCTION.
 *
 * Doet dezelfde stappen als de edge function maar dan vanuit Node:
 *   1. Lightspeed auth-check voor beide shops
 *   2. Haal de N meest recente orders per shop op
 *   3. Kies een specifieke order (via ORDER_ID env) of de nieuwste betaalde
 *   4. Match producten tegen RugFlow.producten
 *   5. Call RPC `create_webshop_order` via Supabase REST (service role)
 *   6. Verifieer dat de order is aangemaakt + idempotent is bij herhaling
 *
 * Hiermee kunnen we de integratielogica valideren zonder dat de edge
 * function gedeployed is. Als dit script slaagt, ligt het probleem bij
 * deploy/webhook-registratie, niet bij de code.
 *
 * Gebruik:
 *   node scripts/test-lightspeed-sync-end-to-end.mjs              # beide shops, nieuwste betaalde order
 *   SHOP=nl node scripts/test-lightspeed-sync-end-to-end.mjs      # alleen NL
 *   SHOP=nl ORDER_ID=12345 node scripts/test-lightspeed-sync-end-to-end.mjs  # specifieke order
 *   DRY_RUN=1 node scripts/test-lightspeed-sync-end-to-end.mjs    # alleen fetch+match, geen DB-insert
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ENV_PATH = resolve(__dirname, '../supabase/functions/.env')
const FRONTEND_ENV_PATH = resolve(__dirname, '../frontend/.env')

function loadEnvFile(path) {
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
  } catch (err) {
    console.warn(`kan ${path} niet lezen: ${err.message}`)
  }
}

loadEnvFile(ENV_PATH)
loadEnvFile(FRONTEND_ENV_PATH)

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
const DEBITEUR_NR = Number(process.env.FLOORPASSION_DEBITEUR_NR ?? 0)
const SHOP_FILTER = process.env.SHOP ?? null
const ORDER_ID = process.env.ORDER_ID ?? null
const DRY_RUN = process.env.DRY_RUN === '1'

function must(name, value) {
  if (!value) {
    console.error(`MIST env var: ${name}`)
    process.exit(1)
  }
  return value
}

must('SUPABASE_URL (of VITE_SUPABASE_URL)', SUPABASE_URL)
must('SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE)
must('FLOORPASSION_DEBITEUR_NR', DEBITEUR_NR)

// -------------------------------------------------------------------
// Lightspeed-client (Node-versie, parallel aan supabase/functions/_shared/lightspeed-client.ts)
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
    const url = `${base}${path}`
    const res = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } })
    if (!res.ok) {
      const body = await res.text().catch(() => '<no body>')
      throw new Error(`Lightspeed ${shop} ${res.status} @ ${path}: ${body.slice(0, 300)}`)
    }
    return res.json()
  }

  return {
    shop,
    ping: () => req('/shop.json'),
    listRecentOrders: () => req('/orders.json?limit=10&sort=-createdAt'),
    getOrder: (id) => req(`/orders/${id}.json`).then((r) => r.order),
    getOrderProducts: (id) => req(`/orders/${id}/products.json`).then((r) => r.orderProducts ?? []),
  }
}

// -------------------------------------------------------------------
// Supabase REST (service role bypass RLS)
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
// Product matcher (Node-versie)
// -------------------------------------------------------------------

async function matchProduct(row) {
  const codes = Array.from(
    new Set([row.articleCode, row.sku].map((v) => (v ?? '').trim()).filter(Boolean)),
  )

  async function tryColumn(column, values) {
    for (const v of values) {
      const rows = await supabaseRest(
        `/rest/v1/producten?${column}=eq.${encodeURIComponent(v)}&select=artikelnr&limit=1`,
      )
      if (rows?.length > 0) return rows[0].artikelnr
    }
    return null
  }

  // 1. karpi_code (primair voor Floorpassion)
  if (codes.length > 0) {
    const hit = await tryColumn('karpi_code', codes)
    if (hit) return { artikelnr: hit, matchedOn: 'karpi_code' }
  }
  // 2. artikelnr
  if (codes.length > 0) {
    const hit = await tryColumn('artikelnr', codes)
    if (hit) return { artikelnr: hit, matchedOn: 'artikelnr' }
  }
  // 3. ean_code
  if (row.ean?.trim()) {
    const hit = await tryColumn('ean_code', [row.ean.trim()])
    if (hit) return { artikelnr: hit, matchedOn: 'ean' }
  }
  // 4. omschrijving (uniek)
  const naam = row.productTitle?.trim()
  if (naam) {
    const rows = await supabaseRest(
      `/rest/v1/producten?omschrijving=ilike.${encodeURIComponent(naam)}&select=artikelnr&limit=2`,
    )
    if (rows?.length === 1) return { artikelnr: rows[0].artikelnr, matchedOn: 'omschrijving' }
  }
  return { artikelnr: null, matchedOn: 'geen' }
}

// -------------------------------------------------------------------
// Hoofdflow per shop
// -------------------------------------------------------------------

function extractShipping(order) {
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

function extractBilling(order) {
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

async function testShop(shopCode) {
  console.log(`\n========== SHOP: ${shopCode.toUpperCase()} ==========`)
  const client = lightspeedClient(shopCode)

  // 1. Auth check
  console.log(`[1/5] Auth check...`)
  try {
    const shop = await client.ping()
    const name = shop?.shop?.title ?? shop?.shop?.name ?? '(onbekend)'
    console.log(`      OK — shop='${name}'`)
  } catch (err) {
    console.error(`      FOUT: ${err.message}`)
    return { shop: shopCode, ok: false, stage: 'auth', error: err.message }
  }

  // 2. Recente orders
  console.log(`[2/5] Recente orders ophalen...`)
  let orders
  try {
    const resp = await client.listRecentOrders()
    orders = resp.orders ?? []
    console.log(`      OK — ${orders.length} orders teruggekregen`)
    if (orders.length === 0) {
      console.log(`      (geen orders om te testen — laat een testbestelling achter)`)
      return { shop: shopCode, ok: true, stage: 'empty' }
    }
    console.log(`      Laatste 3:`)
    for (const o of orders.slice(0, 3)) {
      console.log(
        `        #${o.number} id=${o.id} status=${o.status} paymentStatus=${o.paymentStatus} createdAt=${o.createdAt}`,
      )
    }
  } catch (err) {
    console.error(`      FOUT: ${err.message}`)
    return { shop: shopCode, ok: false, stage: 'list', error: err.message }
  }

  // 3. Kies target order
  let targetId
  if (ORDER_ID) {
    targetId = ORDER_ID
  } else {
    const betaald = orders.find((o) => o.paymentStatus === 'paid')
    targetId = (betaald ?? orders[0]).id
  }
  console.log(`[3/5] Target order id=${targetId}`)

  let order, rows
  try {
    ;[order, rows] = await Promise.all([client.getOrder(targetId), client.getOrderProducts(targetId)])
    console.log(`      OK — order #${order.number}, ${rows.length} regels, €${order.priceIncl}`)
  } catch (err) {
    console.error(`      FOUT: ${err.message}`)
    return { shop: shopCode, ok: false, stage: 'fetch', error: err.message }
  }

  // 4. Match producten
  console.log(`[4/5] Product-matching...`)
  const regels = []
  let matched = 0, unmatched = 0
  for (const row of rows) {
    const m = await matchProduct(row)
    if (m.artikelnr) matched++
    else unmatched++
    const base = [row.productTitle, row.variantTitle].filter(Boolean).join(' — ')
    const omschrijving = m.artikelnr ? base : `[UNMATCHED] ${base || row.articleCode || row.sku || 'onbekend'}`
    console.log(
      `      "${row.productTitle}" sku=${row.sku ?? '-'} articleCode=${row.articleCode ?? '-'} → ` +
        (m.artikelnr ? `artikelnr=${m.artikelnr} (${m.matchedOn})` : 'GEEN MATCH'),
    )
    regels.push({
      artikelnr: m.artikelnr,
      omschrijving,
      omschrijving_2: row.variantTitle ?? null,
      orderaantal: row.quantityOrdered ?? 1,
      te_leveren: row.quantityOrdered ?? 1,
      prijs: row.priceIncl ?? null,
      korting_pct: 0,
      bedrag: (row.priceIncl ?? 0) * (row.quantityOrdered ?? 1),
      gewicht_kg:
        row.weight != null && Number.isFinite(row.weight)
          ? Math.round((row.weight / 1_000_000) * 100) / 100
          : null,
    })
  }
  console.log(`      matched=${matched} unmatched=${unmatched}`)

  if (DRY_RUN) {
    console.log(`[5/5] DRY_RUN — skip DB-insert`)
    return { shop: shopCode, ok: true, matched, unmatched, stage: 'dry_run' }
  }

  // 5. Insert via RPC
  console.log(`[5/5] RPC create_webshop_order...`)
  const header = {
    debiteur_nr: DEBITEUR_NR,
    klant_referentie: `Floorpassion #${order.number}`,
    orderdatum: order.createdAt ? order.createdAt.slice(0, 10) : null,
    afleverdatum: null,
    ...extractShipping(order),
    ...extractBilling(order),
    bron_systeem: 'lightspeed',
    bron_shop: shopCode === 'nl' ? 'floorpassion_nl' : 'floorpassion_de',
    bron_order_id: String(order.id),
  }

  try {
    const resp1 = await supabaseRest('/rest/v1/rpc/create_webshop_order', {
      method: 'POST',
      body: JSON.stringify({ p_header: header, p_regels: regels }),
    })
    const r1 = Array.isArray(resp1) ? resp1[0] : resp1
    console.log(`      1e call: order_nr=${r1?.order_nr} was_existing=${r1?.was_existing}`)

    // Idempotentie-check
    const resp2 = await supabaseRest('/rest/v1/rpc/create_webshop_order', {
      method: 'POST',
      body: JSON.stringify({ p_header: header, p_regels: regels }),
    })
    const r2 = Array.isArray(resp2) ? resp2[0] : resp2
    console.log(`      2e call: order_nr=${r2?.order_nr} was_existing=${r2?.was_existing}`)

    if (r2?.was_existing !== true) {
      console.error(`      FOUT: idempotentie werkt niet — 2e call had was_existing=true moeten zijn`)
      return { shop: shopCode, ok: false, stage: 'idempotency', order_nr: r1?.order_nr }
    }

    return { shop: shopCode, ok: true, order_nr: r1?.order_nr, matched, unmatched, idempotent: true }
  } catch (err) {
    console.error(`      FOUT: ${err.message}`)
    return { shop: shopCode, ok: false, stage: 'rpc', error: err.message }
  }
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------

const shops = SHOP_FILTER ? [SHOP_FILTER] : ['nl', 'de']
const results = []
for (const s of shops) {
  results.push(await testShop(s))
}

console.log(`\n========== SAMENVATTING ==========`)
for (const r of results) {
  const status = r.ok ? 'OK' : `FAIL (${r.stage})`
  const extra = r.order_nr ? ` order_nr=${r.order_nr} matched=${r.matched}/${r.matched + r.unmatched}` : ''
  console.log(`  ${r.shop.toUpperCase()}: ${status}${extra}`)
}
const allOk = results.every((r) => r.ok)
process.exit(allOk ? 0 : 1)
