/**
 * Backfill afleverdatum voor webshop-orders zonder datum.
 *
 * Achtergrond: voordat sync-webshop-order de debiteur-instelling
 * `maatwerk_weken` uitlas, kwamen Floorpassion-orders binnen met
 * afleverdatum NULL. Die vielen in de snijplanning achteraan (of werden
 * als ASAP behandeld zonder afspraak) — terwijl de klant-afspraak 2
 * weken levertijd is.
 *
 * Dit script:
 *   1. Haalt alle orders op met bron_systeem='lightspeed' én
 *      afleverdatum IS NULL.
 *   2. Leest per order de debiteur's maatwerk_weken (fallback 2).
 *   3. Zet afleverdatum = orderdatum + maatwerk_weken × 7 dagen, naar
 *      eerstvolgende werkdag (ma-vr).
 *
 * Gebruik:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/backfill-webshop-afleverdatum.mjs
 *
 * Optie --dry-run: toont wat er zou gebeuren zonder te muteren.
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY zijn verplicht')
  process.exit(1)
}

const DRY_RUN = process.argv.includes('--dry-run')
const DEFAULT_MAATWERK_WEKEN = 2

const headers = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
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

async function fetchOrders() {
  const url = `${SUPABASE_URL}/rest/v1/orders?bron_systeem=eq.lightspeed&afleverdatum=is.null&select=id,order_nr,orderdatum,debiteur_nr`
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`Fetch orders: ${res.status} ${await res.text()}`)
  return res.json()
}

async function fetchDebiteurWeken(debiteurNr) {
  const url = `${SUPABASE_URL}/rest/v1/debiteuren?debiteur_nr=eq.${debiteurNr}&select=maatwerk_weken`
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`Fetch debiteur ${debiteurNr}: ${res.status}`)
  const rows = await res.json()
  const w = rows[0]?.maatwerk_weken
  return typeof w === 'number' && w > 0 ? w : DEFAULT_MAATWERK_WEKEN
}

async function updateAfleverdatum(orderId, afleverdatum) {
  const url = `${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ afleverdatum }),
  })
  if (!res.ok) throw new Error(`PATCH ${orderId}: ${res.status} ${await res.text()}`)
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}`)
  const orders = await fetchOrders()
  console.log(`Orders zonder afleverdatum: ${orders.length}`)

  // Cache debiteur-weken per nr
  const wekenCache = new Map()
  let updated = 0
  let skipped = 0

  for (const o of orders) {
    if (!o.orderdatum) {
      console.warn(`SKIP ${o.order_nr}: geen orderdatum`)
      skipped++
      continue
    }
    let weken = wekenCache.get(o.debiteur_nr)
    if (weken === undefined) {
      weken = await fetchDebiteurWeken(o.debiteur_nr)
      wekenCache.set(o.debiteur_nr, weken)
    }
    const afl = naarWerkdag(plusDagen(o.orderdatum, weken * 7))
    console.log(`${o.order_nr}  orderdatum=${o.orderdatum}  +${weken}w → ${afl}`)
    if (!DRY_RUN) {
      await updateAfleverdatum(o.id, afl)
    }
    updated++
  }

  console.log(`\nKlaar. Updated: ${updated}, skipped: ${skipped}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
