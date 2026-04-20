/**
 * Backfill klantprijs voor bestaande Floorpassion webshop-orderregels.
 *
 * Waarom: tot nu toe landde de Lightspeed `priceIncl` (consumentprijs) op
 * `order_regels.prijs`. Karpi factureert aan Floorpassion, dus de prijs moet
 * uit `prijslijst_regels` komen (debiteur.prijslijst_nr; voor maatwerk ×
 * oppervlak in m²). Dit script herrekent `prijs` + `bedrag` voor alle
 * webshop-orders van een bepaalde debiteur.
 *
 * Gebruik:
 *   node scripts/backfill-floorpassion-klantprijs.mjs [--dry-run]
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-geladen uit .env)
 *   FLOORPASSION_DEBITEUR_NR (default 260000)
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
const DEBITEUR_NR = Number(process.env.FLOORPASSION_DEBITEUR_NR ?? 260000)
const DRY_RUN = process.argv.includes('--dry-run')

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY verplicht')
  process.exit(1)
}

const H = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` }

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { headers: H })
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function sbPatch(path, patch) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'PATCH',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`PATCH ${path}: ${res.status} ${await res.text()}`)
}

function oppervlakM2(lengte, breedte) {
  if (!lengte || !breedte || lengte <= 0 || breedte <= 0) return 0
  return (lengte * breedte) / 10000
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}  debiteur: ${DEBITEUR_NR}\n`)

  // 1) Prijslijst van de debiteur
  const deb = (await sbGet(`/rest/v1/debiteuren?debiteur_nr=eq.${DEBITEUR_NR}&select=prijslijst_nr,naam`))[0]
  if (!deb?.prijslijst_nr) {
    console.error(`Geen prijslijst_nr voor debiteur ${DEBITEUR_NR} (${deb?.naam ?? '?'})`)
    process.exit(1)
  }
  const prijslijstNr = deb.prijslijst_nr
  console.log(`Debiteur: ${deb.naam}, prijslijst ${prijslijstNr}`)

  // 2) Alle webshop-orders van deze debiteur
  const orders = await sbGet(
    `/rest/v1/orders?debiteur_nr=eq.${DEBITEUR_NR}&bron_systeem=eq.lightspeed&select=id,order_nr`,
  )
  if (orders.length === 0) {
    console.log('Geen webshop-orders gevonden.')
    return
  }
  console.log(`Webshop-orders: ${orders.length}`)

  const orderIds = orders.map((o) => o.id)
  // Regels in batches ophalen
  const regels = []
  const CHUNK = 100
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const ids = orderIds.slice(i, i + CHUNK)
    const batch = await sbGet(
      `/rest/v1/order_regels?order_id=in.(${ids.join(',')})&select=id,order_id,regelnummer,artikelnr,orderaantal,prijs,bedrag,korting_pct,is_maatwerk,maatwerk_lengte_cm,maatwerk_breedte_cm`,
    )
    regels.push(...batch)
  }
  console.log(`Orderregels: ${regels.length}\n`)

  // 3) Unieke artikelnrs → fetch prijslijst-prijzen + verkoopprijzen in bulk
  const artikelnrs = [...new Set(regels.map((r) => r.artikelnr).filter(Boolean))]
  const prijslijstMap = new Map()
  for (let i = 0; i < artikelnrs.length; i += CHUNK) {
    const ids = artikelnrs.slice(i, i + CHUNK).map(encodeURIComponent).join(',')
    const rows = await sbGet(
      `/rest/v1/prijslijst_regels?prijslijst_nr=eq.${prijslijstNr}&artikelnr=in.(${ids})&select=artikelnr,prijs`,
    )
    for (const r of rows) prijslijstMap.set(r.artikelnr, Number(r.prijs))
  }
  const verkoopMap = new Map()
  for (let i = 0; i < artikelnrs.length; i += CHUNK) {
    const ids = artikelnrs.slice(i, i + CHUNK).map(encodeURIComponent).join(',')
    const rows = await sbGet(
      `/rest/v1/producten?artikelnr=in.(${ids})&select=artikelnr,verkoopprijs`,
    )
    for (const r of rows) if (r.verkoopprijs != null) verkoopMap.set(r.artikelnr, Number(r.verkoopprijs))
  }

  const byOrder = new Map(orders.map((o) => [o.id, o]))
  const stats = { updated: 0, ongewijzigd: 0, geen_prijs: 0, geen_artikel: 0 }

  for (const r of regels) {
    const o = byOrder.get(r.order_id)
    if (!r.artikelnr) { stats.geen_artikel++; continue }

    const basis = prijslijstMap.get(r.artikelnr) ?? verkoopMap.get(r.artikelnr) ?? null
    if (basis == null) { stats.geen_prijs++; continue }

    const bron = prijslijstMap.has(r.artikelnr) ? 'prijslijst' : 'verkoopprijs'
    let nieuwePrijs
    if (r.is_maatwerk && bron === 'prijslijst') {
      const opp = oppervlakM2(r.maatwerk_lengte_cm, r.maatwerk_breedte_cm)
      nieuwePrijs = opp > 0 ? Math.round(basis * opp * 100) / 100 : basis
    } else {
      nieuwePrijs = basis
    }
    const aantal = r.orderaantal ?? 1
    const kortingFactor = 1 - ((r.korting_pct ?? 0) / 100)
    const nieuwBedrag = Math.round(nieuwePrijs * aantal * kortingFactor * 100) / 100

    const huidigePrijs = r.prijs != null ? Number(r.prijs) : null
    const huidigBedrag = r.bedrag != null ? Number(r.bedrag) : null
    if (huidigePrijs === nieuwePrijs && huidigBedrag === nieuwBedrag) {
      stats.ongewijzigd++
      continue
    }

    console.log(
      `  ${o.order_nr} r${r.regelnummer} (${r.artikelnr}${r.is_maatwerk ? '/MW' : ''}): ` +
      `€${huidigePrijs ?? '—'} → €${nieuwePrijs}${r.is_maatwerk ? ` (${r.maatwerk_lengte_cm}×${r.maatwerk_breedte_cm} × €${basis}/m²)` : ''}`,
    )
    if (!DRY_RUN) {
      await sbPatch(`/rest/v1/order_regels?id=eq.${r.id}`, { prijs: nieuwePrijs, bedrag: nieuwBedrag })
    }
    stats.updated++
  }

  console.log('\n=== SAMENVATTING ===')
  for (const [k, v] of Object.entries(stats)) if (v > 0) console.log(`  ${k}: ${v}`)
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
