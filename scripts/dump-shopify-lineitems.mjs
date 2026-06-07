/**
 * READ-ONLY diagnose-script: dump de rauwe Shopify-regelvelden van orders.
 *
 * Schrijft NIETS naar Supabase of Shopify — haalt alleen op en print.
 * Doel: zien hoe productregels exact binnenkomen (title / variant_title / sku /
 * properties), inclusief de gekoppelde variant (echte SKU + barcode) zodat we
 * kunnen bepalen waarop de product-matcher moet koppelen.
 *
 * Gebruik:
 *   node scripts/dump-shopify-lineitems.mjs                 # laatste 10 orders
 *   node scripts/dump-shopify-lineitems.mjs 5575 5571       # specifieke order-nummers (#5575)
 *   LIMIT=25 node scripts/dump-shopify-lineitems.mjs        # laatste 25 orders
 *
 * Vereiste env-vars (in supabase/functions/.env, frontend/.env of als shell-var):
 *   SHOPIFY_SHOP_DOMAIN     bijv. karpi-bv.myshopify.com
 *   SHOPIFY_ACCESS_TOKEN    shpat_...
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
  } catch { /* optioneel */ }
}

loadEnv(resolve(__dirname, '../supabase/functions/.env'))
loadEnv(resolve(__dirname, '../frontend/.env'))

const SHOP_DOMAIN  = process.env.SHOPIFY_SHOP_DOMAIN
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const API_VERSION  = process.env.SHOPIFY_API_VERSION ?? '2024-01'
const LIMIT        = parseInt(process.env.LIMIT ?? '10', 10)

if (!SHOP_DOMAIN || !ACCESS_TOKEN) {
  console.error('Verplicht: SHOPIFY_SHOP_DOMAIN en SHOPIFY_ACCESS_TOKEN (in supabase/functions/.env of als shell-var)')
  process.exit(1)
}

const BASE = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}`
const HEADERS = { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' }

const wantedNames = process.argv.slice(2).map(s => s.replace(/^#/, ''))

async function shopifyGet(url) {
  const res = await fetch(url, { headers: HEADERS })
  if (res.status === 429) {
    const retryAfter = parseFloat(res.headers.get('Retry-After') ?? '2')
    await new Promise(r => setTimeout(r, retryAfter * 1000))
    return shopifyGet(url)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Shopify ${res.status} @ ${url}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

// Cache variant-lookups (echte SKU + barcode hangen aan de variant, niet altijd
// aan de line_item).
const variantCache = new Map()
async function fetchVariant(variantId) {
  if (!variantId) return null
  if (variantCache.has(variantId)) return variantCache.get(variantId)
  try {
    const data = await shopifyGet(`${BASE}/variants/${variantId}.json`)
    const v = data.variant ?? null
    variantCache.set(variantId, v)
    return v
  } catch {
    return null
  }
}

function fmt(v) {
  if (v == null || v === '') return '∅'
  return JSON.stringify(v)
}

async function dumpOrder(order) {
  console.log('═'.repeat(72))
  console.log(`Order ${order.name}  (id=${order.id})  ${order.created_at?.slice(0, 10)}`)
  console.log(`  company       : ${fmt(order.company?.name)}`)
  console.log(`  billing comp. : ${fmt(order.billing_address?.company)}`)
  console.log(`  email         : ${fmt(order.email ?? order.customer?.email)}`)
  console.log(`  note          : ${fmt(order.note)}`)
  console.log(`  regels        : ${order.line_items?.length ?? 0}`)
  for (const [i, item] of (order.line_items ?? []).entries()) {
    const variant = await fetchVariant(item.variant_id)
    console.log(`  ── regel ${i + 1} ───────────────────────────────────────────`)
    console.log(`     title            : ${fmt(item.title)}`)
    console.log(`     variant_title    : ${fmt(item.variant_title)}`)
    console.log(`     name             : ${fmt(item.name)}`)
    console.log(`     line_item.sku    : ${fmt(item.sku)}`)
    console.log(`     variant.sku      : ${fmt(variant?.sku)}`)
    console.log(`     variant.barcode  : ${fmt(variant?.barcode)}`)
    console.log(`     price / qty      : ${fmt(item.price)} × ${fmt(item.quantity)}`)
    console.log(`     grams            : ${fmt(item.grams)}`)
    console.log(`     product_id       : ${fmt(item.product_id)}   variant_id: ${fmt(item.variant_id)}`)
    const props = item.properties ?? []
    if (props.length) {
      console.log(`     properties       :`)
      for (const p of props) console.log(`        - ${p.name} = ${fmt(p.value)}`)
    } else {
      console.log(`     properties       : ∅`)
    }
  }
}

async function main() {
  console.log(`Shop: ${SHOP_DOMAIN}  api=${API_VERSION}`)
  let orders = []
  if (wantedNames.length) {
    // Op naam/nummer zoeken (Shopify 'name' is "#5575"; we matchen op order_number)
    const data = await shopifyGet(`${BASE}/orders.json?status=any&limit=250&order=created_at+desc`)
    orders = (data.orders ?? []).filter(o =>
      wantedNames.includes(String(o.order_number)) ||
      wantedNames.includes(String(o.name).replace(/^#/, '')),
    )
    if (!orders.length) {
      console.error(`Geen orders gevonden voor: ${wantedNames.join(', ')} (laatste 250 doorzocht)`)
      process.exit(1)
    }
  } else {
    const data = await shopifyGet(`${BASE}/orders.json?status=any&limit=${LIMIT}&order=created_at+desc`)
    orders = data.orders ?? []
  }

  for (const order of orders) await dumpOrder(order)
  console.log('═'.repeat(72))
  console.log(`Klaar — ${orders.length} order(s) gedumpt.`)
}

await main()
