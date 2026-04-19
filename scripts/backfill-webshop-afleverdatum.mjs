/**
 * Backfill afleverdatum voor webshop-orders zonder datum.
 *
 * Strategie (zelfde logica als sync-webshop-order voor nieuwe orders):
 *   1. Haal de order opnieuw op bij Lightspeed (get /orders/:id).
 *   2. Native `deliveryDate` gebruiken als gezet.
 *   3. `shipmentTitle` parsen:
 *        NL: "Bezorging op woensdag 22 april"
 *            "Express levering — uiterlijk 22 april geleverd."
 *            "Levering binnen 4 – 8 weken"
 *        DE: "Versandfertig innerhalb von 2 Wochen"
 *            "Versandfertig in 2 Arbeitstagen"
 *   4. Fallback: orderdatum + debiteur.maatwerk_weken × 7 dagen.
 *   5. Resultaat naar eerstvolgende werkdag (ma-vr).
 *
 * Gebruik:
 *   node scripts/backfill-webshop-afleverdatum.mjs [--dry-run]
 *
 * Verwachte env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   LIGHTSPEED_NL_API_KEY, LIGHTSPEED_NL_API_SECRET, LIGHTSPEED_NL_CLUSTER_URL
 *   LIGHTSPEED_DE_API_KEY, LIGHTSPEED_DE_API_SECRET, LIGHTSPEED_DE_CLUSTER_URL
 */

import fs from 'node:fs'
import path from 'node:path'

// Laad .env-bestanden als de waarden nog niet in process.env staan.
// VITE_-prefixen mappen we ook naar hun plain naam voor convenience.
for (const f of ['supabase/functions/.env', 'frontend/.env']) {
  const p = path.resolve(f)
  if (!fs.existsSync(p)) continue
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    const key = m[1].startsWith('VITE_') ? m[1].slice(5) : m[1]
    if (!process.env[key]) process.env[key] = m[2]
    if (!process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY zijn verplicht')
  process.exit(1)
}

const DRY_RUN = process.argv.includes('--dry-run')
const DEFAULT_MAATWERK_WEKEN = 2

const MAANDEN = {
  januari:1, februari:2, maart:3, april:4, mei:5, juni:6, juli:7, augustus:8,
  september:9, oktober:10, november:11, december:12,
  jan:1, feb:2, mrt:3, apr:4, jun:6, jul:7, aug:8, sep:9, okt:10, nov:11, dec:12,
  januar:1, februar:2, märz:3, maerz:3, mai:5, august:8, oktober:10, dezember:12,
}

function plusDagen(iso, dagen) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dagen)
  return d.toISOString().slice(0, 10)
}

function naarWerkdag(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return d.toISOString().slice(0, 10)
}

function parseDagMaand(tekst, basisIso) {
  const lc = (tekst ?? '').toLowerCase()
  const basis = new Date(`${basisIso}T00:00:00Z`)
  const regex = /(\d{1,2})\.?\s+([a-zäöüß]+)/gi
  let m
  while ((m = regex.exec(lc)) !== null) {
    const dag = parseInt(m[1], 10)
    const maand = MAANDEN[m[2].replace(/[.,]/g, '')]
    if (!maand || dag < 1 || dag > 31) continue
    for (const jaar of [basis.getUTCFullYear(), basis.getUTCFullYear() + 1]) {
      const kandidaat = new Date(Date.UTC(jaar, maand - 1, dag))
      if (kandidaat >= basis) return kandidaat.toISOString().slice(0, 10)
    }
  }
  return null
}

function parseDuurDagen(tekst) {
  const lc = (tekst ?? '').toLowerCase()
  const rangeWeken = lc.match(/(\d+)\s*[–\-]\s*(\d+)\s*w(e|o)/)
  if (rangeWeken) return parseInt(rangeWeken[2], 10) * 7
  const weken = lc.match(/(\d+)\s*w(e|o)/)
  if (weken) return parseInt(weken[1], 10) * 7
  const werkdagen = lc.match(/(\d+)\s*(werkdag|arbeitstag)/)
  if (werkdagen) return Math.ceil(parseInt(werkdagen[1], 10) * 1.5)
  const dagen = lc.match(/(\d+)\s*(dagen|tage)/)
  if (dagen) return parseInt(dagen[1], 10)
  return null
}

function bepaalAfleverdatum(order, fallbackWeken) {
  const orderdatum = order.createdAt ? order.createdAt.slice(0, 10) : null
  if (order.deliveryDate) {
    return { afl: naarWerkdag(order.deliveryDate.slice(0, 10)), bron: 'deliveryDate', titel: null }
  }
  const titel = order.shipmentTitle ?? ''
  if (titel && orderdatum) {
    const dm = parseDagMaand(titel, orderdatum)
    if (dm) return { afl: naarWerkdag(dm), bron: 'titel_datum', titel }
    const d = parseDuurDagen(titel)
    if (d !== null) return { afl: naarWerkdag(plusDagen(orderdatum, d)), bron: 'titel_duur', titel }
  }
  if (!orderdatum) return { afl: null, bron: 'geen_orderdatum', titel }
  return { afl: naarWerkdag(plusDagen(orderdatum, fallbackWeken * 7)), bron: 'fallback', titel }
}

const supaHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
}

async function fetchOrders() {
  const url = `${SUPABASE_URL}/rest/v1/orders?bron_systeem=eq.lightspeed&afleverdatum=is.null&select=id,order_nr,orderdatum,debiteur_nr,bron_order_id,bron_shop`
  const res = await fetch(url, { headers: supaHeaders })
  if (!res.ok) throw new Error(`Fetch orders: ${res.status} ${await res.text()}`)
  return res.json()
}

async function fetchDebiteurWeken(debiteurNr) {
  const url = `${SUPABASE_URL}/rest/v1/debiteuren?debiteur_nr=eq.${debiteurNr}&select=maatwerk_weken`
  const res = await fetch(url, { headers: supaHeaders })
  if (!res.ok) throw new Error(`Fetch debiteur ${debiteurNr}: ${res.status}`)
  const rows = await res.json()
  const w = rows[0]?.maatwerk_weken
  return typeof w === 'number' && w > 0 ? w : DEFAULT_MAATWERK_WEKEN
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

async function fetchLightspeedOrder(bronShop, bronOrderId) {
  const creds = lightspeedCreds(bronShop)
  if (!creds) throw new Error(`Geen credentials voor ${bronShop}`)
  const res = await fetch(`${creds.base}/orders/${bronOrderId}.json`, {
    headers: { Authorization: creds.auth, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Lightspeed ${bronShop} ${bronOrderId}: ${res.status}`)
  const data = await res.json()
  return data.order
}

async function updateAfleverdatum(orderId, afleverdatum) {
  const url = `${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...supaHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({ afleverdatum }),
  })
  if (!res.ok) throw new Error(`PATCH ${orderId}: ${res.status} ${await res.text()}`)
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}`)
  const orders = await fetchOrders()
  console.log(`Orders zonder afleverdatum: ${orders.length}\n`)

  const wekenCache = new Map()
  const bronTeller = { deliveryDate: 0, titel_datum: 0, titel_duur: 0, fallback: 0, geen_orderdatum: 0, error: 0 }
  let i = 0

  for (const o of orders) {
    i++
    try {
      const lsOrder = await fetchLightspeedOrder(o.bron_shop, o.bron_order_id)
      let weken = wekenCache.get(o.debiteur_nr)
      if (weken === undefined) {
        weken = await fetchDebiteurWeken(o.debiteur_nr)
        wekenCache.set(o.debiteur_nr, weken)
      }
      const r = bepaalAfleverdatum(lsOrder, weken)
      bronTeller[r.bron] = (bronTeller[r.bron] ?? 0) + 1

      const titelTxt = r.titel ? ` "${r.titel.slice(0, 60)}"` : ''
      console.log(`[${i}/${orders.length}] ${o.order_nr}  ${r.bron}  → ${r.afl ?? 'NULL'}${titelTxt}`)

      if (r.afl && !DRY_RUN) await updateAfleverdatum(o.id, r.afl)
      // Korte delay tegen rate-limit (Lightspeed: 30 req/sec per bucket)
      await new Promise((res) => setTimeout(res, 50))
    } catch (err) {
      bronTeller.error++
      console.error(`[${i}/${orders.length}] ${o.order_nr}  ERROR: ${err.message}`)
    }
  }

  console.log('\n=== SAMENVATTING ===')
  for (const [k, v] of Object.entries(bronTeller)) {
    if (v > 0) console.log(`  ${k}: ${v}`)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
