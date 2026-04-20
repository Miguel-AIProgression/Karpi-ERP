/**
 * Backfill maatwerk-afmeting + kwaliteit/kleur voor bestaande webshop-regels.
 *
 * Vindt order_regels met omschrijving `[MAATWERK]` / `[MAATWERK-ROND]` en
 * lege `maatwerk_lengte_cm`. Haalt de oorspronkelijke order opnieuw op bij
 * Lightspeed om de afmeting uit `customFields` ("Afmeting: 280x360 (cm)")
 * te lezen. Vult tegelijk `is_maatwerk=true`, kwaliteit/kleur uit articleCode.
 *
 * Gebruik:
 *   node scripts/backfill-maatwerk-afmeting.mjs [--dry-run]
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

const AFM_RE = /(\d+)\s*[xX×]\s*(\d+)/

const sbHeaders = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
}

function parseArticleCode(code) {
  if (!code) return { kwaliteit: null, kleur: null }
  const m = code.match(/^([A-Z]{2,6})(\d{1,3})/i)
  if (!m) return { kwaliteit: null, kleur: null }
  return { kwaliteit: m[1].toUpperCase(), kleur: m[2] }
}

function collectTexts(row) {
  const fields = Array.isArray(row.customFields) ? row.customFields : []
  const out = []
  for (const f of fields) {
    const values = Array.isArray(f.values) ? f.values : []
    for (const v of values) {
      if (v.value != null && typeof v.value === 'string') out.push(v.value)
    }
  }
  return out
}

function parseAfmeting(row) {
  const hay = [row.variantTitle, row.productTitle, ...collectTexts(row)].join(' ')
  const m = hay.match(AFM_RE)
  if (!m) return { lengte: null, breedte: null }
  return { lengte: parseInt(m[1], 10), breedte: parseInt(m[2], 10) }
}

function lightspeedCreds(bronShop) {
  const shop = bronShop === 'floorpassion_nl' ? 'NL' : bronShop === 'floorpassion_de' ? 'DE' : null
  if (!shop) return null
  const key = process.env[`LIGHTSPEED_${shop}_API_KEY`]
  const secret = process.env[`LIGHTSPEED_${shop}_API_SECRET`]
  const base = process.env[`LIGHTSPEED_${shop}_CLUSTER_URL`]
  if (!key || !secret || !base) return null
  return { auth: 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64'), base: base.replace(/\/$/, '') }
}

async function fetchOrderProducts(bronShop, bronOrderId) {
  const creds = lightspeedCreds(bronShop)
  if (!creds) throw new Error(`Geen credentials voor ${bronShop}`)
  const res = await fetch(`${creds.base}/orders/${bronOrderId}/products.json`, {
    headers: { Authorization: creds.auth, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Lightspeed ${bronShop} ${bronOrderId}: ${res.status}`)
  return (await res.json()).orderProducts ?? []
}

async function findTargetRegels() {
  const url = new URL(`${SUPABASE_URL}/rest/v1/order_regels`)
  url.searchParams.set('or', '(omschrijving.like.[MAATWERK]*,omschrijving.like.[MAATWERK-ROND]*)')
  url.searchParams.set('maatwerk_lengte_cm', 'is.null')
  url.searchParams.set('select', 'id,order_id,regelnummer,omschrijving,omschrijving_2')
  const res = await fetch(url, { headers: sbHeaders })
  if (!res.ok) throw new Error(`Fetch regels: ${res.status} ${await res.text()}`)
  return res.json()
}

async function fetchOrderMeta(orderIds) {
  if (orderIds.length === 0) return new Map()
  const url = new URL(`${SUPABASE_URL}/rest/v1/orders`)
  url.searchParams.set('id', `in.(${orderIds.join(',')})`)
  url.searchParams.set('select', 'id,order_nr,bron_shop,bron_order_id')
  const res = await fetch(url, { headers: sbHeaders })
  if (!res.ok) throw new Error(`Fetch orders: ${res.status}`)
  const data = await res.json()
  return new Map(data.map((o) => [o.id, o]))
}

async function updateRegel(id, patch) {
  const url = `${SUPABASE_URL}/rest/v1/order_regels?id=eq.${id}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`PATCH ${id}: ${res.status} ${await res.text()}`)
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`)
  const regels = await findTargetRegels()
  console.log(`Maatwerk-regels zonder afmeting: ${regels.length}`)
  const orderIds = [...new Set(regels.map((r) => r.order_id))]
  const ordersById = await fetchOrderMeta(orderIds)
  console.log(`Over ${ordersById.size} unieke orders\n`)

  // Cache Lightspeed fetches per order
  const productsCache = new Map()
  const stats = { updated: 0, geen_match: 0, geen_afmeting: 0, error: 0 }

  for (const regel of regels) {
    const order = ordersById.get(regel.order_id)
    if (!order) {
      stats.error++
      console.warn(`SKIP regel ${regel.id}: order ${regel.order_id} niet gevonden`)
      continue
    }

    try {
      const cacheKey = `${order.bron_shop}:${order.bron_order_id}`
      let products = productsCache.get(cacheKey)
      if (!products) {
        products = await fetchOrderProducts(order.bron_shop, order.bron_order_id)
        productsCache.set(cacheKey, products)
        await new Promise((r) => setTimeout(r, 80)) // rate-limit
      }

      // Match regel op Lightspeed product via regelnummer (index) of omschrijving
      // Regelnummer is 1-based in onze DB.
      let lsRow = products[regel.regelnummer - 1] ?? null
      if (!lsRow) {
        // Fallback: zoek via productTitle-fragment
        const base = (regel.omschrijving || '').replace(/^\[[A-Z-]+\]\s*/, '').split(' — ')[0]
        lsRow = products.find((p) => (p.productTitle ?? '').includes(base)) ?? null
      }
      if (!lsRow) {
        stats.geen_match++
        console.warn(`  ${order.order_nr} regel ${regel.regelnummer}: geen LS-product gematcht`)
        continue
      }

      const afm = parseAfmeting(lsRow)
      const art = parseArticleCode(lsRow.articleCode)
      if (afm.lengte == null) {
        stats.geen_afmeting++
        console.warn(`  ${order.order_nr} regel ${regel.regelnummer}: geen afmeting in LS-data`)
        continue
      }

      const patch = {
        is_maatwerk: true,
        maatwerk_lengte_cm: afm.lengte,
        maatwerk_breedte_cm: afm.breedte,
        maatwerk_kwaliteit_code: art.kwaliteit,
        maatwerk_kleur_code: art.kleur,
      }
      console.log(
        `  ${order.order_nr} regel ${regel.regelnummer}: ` +
          `${afm.lengte}×${afm.breedte} cm  ${art.kwaliteit ?? '?'}-${art.kleur ?? '?'}`,
      )
      if (!DRY_RUN) await updateRegel(regel.id, patch)
      stats.updated++
    } catch (err) {
      stats.error++
      console.error(`  ${order.order_nr} regel ${regel.regelnummer}: ERROR ${err.message}`)
    }
  }

  console.log('\n=== SAMENVATTING ===')
  for (const [k, v] of Object.entries(stats)) if (v > 0) console.log(`  ${k}: ${v}`)
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
