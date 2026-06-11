/**
 * Eenmalige bulk-import van Shopify orders → RugFlow ERP.
 *
 * Haalt alle orders op vanaf SINCE_DATE (default 2026-06-01) en importeert
 * ze via RPC `create_webshop_order`. Idempotent — bestaande orders worden
 * overgeslagen. Veilig om meerdere keren te draaien.
 *
 * Gebruik:
 *   node scripts/import-shopify-orders.mjs
 *
 * Optionele env-vars:
 *   SINCE_DATE=2026-06-01        Datum vanaf (default: 2026-06-01)
 *   DRY_RUN=1                   Niets opslaan, alleen loggen
 *   VERBOSE=1                   Toon ook bestaande (overgeslagen) orders
 *
 * Vereiste env-vars (in supabase/functions/.env of als shell-var):
 *   SHOPIFY_SHOP_DOMAIN          bijv. karpi-bv.myshopify.com
 *   SHOPIFY_ACCESS_TOKEN         shpat_...
 *   SUPABASE_URL / VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
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

const SHOP_DOMAIN    = process.env.SHOPIFY_SHOP_DOMAIN
const ACCESS_TOKEN   = process.env.SHOPIFY_ACCESS_TOKEN
const SUPABASE_URL   = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
const SERVICE_ROLE   = process.env.SUPABASE_SERVICE_ROLE_KEY
const SINCE_DATE     = process.env.SINCE_DATE ?? '2026-06-01'
const DRY_RUN        = process.env.DRY_RUN === '1'
const VERBOSE        = process.env.VERBOSE === '1'
const API_VERSION    = '2024-01'

if (!SHOP_DOMAIN || !ACCESS_TOKEN) {
  console.error('Verplicht: SHOPIFY_SHOP_DOMAIN en SHOPIFY_ACCESS_TOKEN')
  process.exit(1)
}
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Verplicht: SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const SHOPIFY_BASE = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}`
const SHOPIFY_HEADERS = {
  'X-Shopify-Access-Token': ACCESS_TOKEN,
  'Content-Type': 'application/json',
}

// ─── Shopify API ──────────────────────────────────────────────────────────────

async function shopifyGet(url) {
  const res = await fetch(url, { headers: SHOPIFY_HEADERS })
  if (res.status === 429) {
    // Rate limit — wacht en probeer opnieuw
    const retryAfter = parseFloat(res.headers.get('Retry-After') ?? '2')
    console.warn(`  Rate limit — wacht ${retryAfter}s...`)
    await sleep(retryAfter * 1000)
    return shopifyGet(url)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Shopify ${res.status} @ ${url}: ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  const linkHeader = res.headers.get('link') ?? ''
  const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  const nextUrl = nextMatch ? nextMatch[1] : null
  return { data, nextUrl }
}

async function* fetchAllOrders() {
  const sinceISO = new Date(SINCE_DATE + 'T00:00:00Z').toISOString()
  // status=any haalt ook 'pending' (factuur) orders op, niet alleen betaalde
  let url = `${SHOPIFY_BASE}/orders.json?status=any&created_at_min=${encodeURIComponent(sinceISO)}&limit=250&order=created_at+asc`

  while (url) {
    const { data, nextUrl } = await shopifyGet(url)
    const orders = data.orders ?? []
    for (const order of orders) yield order
    url = nextUrl
  }
}

// ─── Supabase REST ────────────────────────────────────────────────────────────

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

// ─── Debiteur matching ────────────────────────────────────────────────────────

const DEBITEUR_NR_RE = /(?:debiteur(?:nummer)?|deb(?:\.?nr\.?)?)[:\s#\-]*(\d{4,6})/i

function extractDebiteurNr(tekst) {
  if (!tekst) return null
  const m = tekst.match(DEBITEUR_NR_RE)
  return m ? parseInt(m[1], 10) : null
}

async function debiteurBestaat(nr) {
  const r = await supabaseRest(
    `/rest/v1/debiteuren?debiteur_nr=eq.${nr}&select=debiteur_nr&limit=1`
  )
  return (r?.length ?? 0) > 0
}

async function zoekDebiteurOpNaam(naam) {
  if (!naam?.trim()) return null
  // Exact ilike match
  const r1 = await supabaseRest(
    `/rest/v1/debiteuren?naam=ilike.${encodeURIComponent(naam)}&select=debiteur_nr&limit=1`
  )
  if (r1?.length === 1) return r1[0].debiteur_nr
  // Partial match
  const r2 = await supabaseRest(
    `/rest/v1/debiteuren?naam=ilike.${encodeURIComponent('%' + naam + '%')}&select=debiteur_nr&limit=2`
  )
  if (r2?.length === 1) return r2[0].debiteur_nr
  return null
}

async function zoekDebiteurOpEmail(email) {
  if (!email?.trim()) return null
  const r = await supabaseRest(
    `/rest/v1/debiteuren?or=(email_factuur.ilike.${encodeURIComponent(email)},email.ilike.${encodeURIComponent(email)})&select=debiteur_nr&limit=1`
  )
  return r?.length === 1 ? r[0].debiteur_nr : null
}

async function matchDebiteur(order) {
  // 1. note_attributes
  for (const attr of order.note_attributes ?? []) {
    if (/debiteur|deb[_\s]?nr/i.test(attr.name)) {
      const nr = parseInt(attr.value, 10)
      if (!isNaN(nr) && nr > 0 && await debiteurBestaat(nr)) {
        return { nr, bron: 'note_attribute' }
      }
    }
  }

  // 2. order.note
  const nrNote = extractDebiteurNr(order.note)
  if (nrNote && await debiteurBestaat(nrNote)) return { nr: nrNote, bron: 'order_note' }

  // 3. customer.note
  const nrKlant = extractDebiteurNr(order.customer?.note)
  if (nrKlant && await debiteurBestaat(nrKlant)) return { nr: nrKlant, bron: 'customer_note' }

  // 4. customer tags
  for (const tag of (order.customer?.tags ?? '').split(',').map(t => t.trim())) {
    const m = tag.match(/^(?:deb|debiteur)[:\-](\d{4,6})$/i)
    if (m) {
      const nr = parseInt(m[1], 10)
      if (await debiteurBestaat(nr)) return { nr, bron: 'customer_tag' }
    }
  }

  // 5. B2B company name
  if (order.company?.name) {
    const nr = await zoekDebiteurOpNaam(order.company.name)
    if (nr) return { nr, bron: 'company_name' }
  }

  // 6. billing_address.company
  if (order.billing_address?.company) {
    const nr = await zoekDebiteurOpNaam(order.billing_address.company)
    if (nr) return { nr, bron: 'billing_company' }
  }

  // 7. email
  const email = order.email ?? order.customer?.email
  if (email) {
    const nr = await zoekDebiteurOpEmail(email)
    if (nr) return { nr, bron: 'email' }
  }

  return null
}

// ─── Product matching ─────────────────────────────────────────────────────────

const VERZEND_RE = /verzend|shipping/i
const AFM_RE     = /(\d{2,3})\s*[xX×]\s*(\d{2,3})/

async function tryKarpiCode(codes) {
  for (const code of codes) {
    const r = await supabaseRest(
      `/rest/v1/producten?karpi_code=eq.${encodeURIComponent(code)}&select=artikelnr&limit=1`
    )
    if (r?.length > 0) return r[0].artikelnr
  }
  return null
}

async function tryArtikelNr(codes) {
  for (const code of codes) {
    const r = await supabaseRest(
      `/rest/v1/producten?artikelnr=eq.${encodeURIComponent(code)}&select=artikelnr&limit=1`
    )
    if (r?.length > 0) return r[0].artikelnr
  }
  return null
}

async function matchProduct(item) {
  const blob = `${item.title ?? ''} ${item.variant_title ?? ''}`

  if (VERZEND_RE.test(blob)) return { artikelnr: 'VERZEND', bron: 'verzend' }

  const sku = item.sku?.trim()
  const codes = sku ? [sku] : []

  if (codes.length > 0) {
    const hit = await tryKarpiCode(codes)
    if (hit) return { artikelnr: hit, bron: 'karpi_code' }
    const hit2 = await tryArtikelNr(codes)
    if (hit2) return { artikelnr: hit2, bron: 'artikelnr' }
  }

  // Naam + afmeting → karpi_code opbouwen
  const titel = (item.title ?? '').replace(/\s*-.*$/, '').trim()
  const kleurM = titel.match(/^(.+?)\s+(\d{1,3})\s*$/)
  const afmStr = item.variant_title ?? item.title ?? ''
  const afmM = afmStr.match(AFM_RE)
  if (kleurM && afmM) {
    const prefix = kleurM[1].replace(/\s+/g, '').slice(0, 4).toUpperCase()
    const kleur  = kleurM[2].padStart(2, '0')
    const a = String(afmM[1]).padStart(3, '0')
    const b = String(afmM[2]).padStart(3, '0')
    const hit = await tryKarpiCode([`${prefix}${kleur}XX${a}${b}`, `${prefix}${kleur}XX${b}${a}`])
    if (hit) return { artikelnr: hit, bron: 'parsed_karpi' }
  }

  // Omschrijving ilike (alleen unieke match)
  if (item.title?.trim()) {
    const r = await supabaseRest(
      `/rest/v1/producten?omschrijving=ilike.${encodeURIComponent(item.title.trim())}&select=artikelnr&limit=2`
    )
    if (r?.length === 1) return { artikelnr: r[0].artikelnr, bron: 'omschrijving' }
  }

  return { artikelnr: null, bron: 'geen' }
}

// ─── Adres helpers ────────────────────────────────────────────────────────────

function adresUit(a) {
  if (!a) return {}
  return {
    afl_naam:     [a.first_name, a.last_name].filter(Boolean).join(' ') || a.name || a.company || null,
    afl_naam_2:   a.company ?? null,
    afl_adres:    [a.address1, a.address2].filter(Boolean).join(' ') || null,
    afl_postcode: a.zip ?? null,
    afl_plaats:   a.city ?? null,
    afl_land:     a.country_code ?? null,
  }
}

function factuuradrseUit(a) {
  if (!a) return {}
  return {
    fact_naam:     [a.first_name, a.last_name].filter(Boolean).join(' ') || a.name || a.company || null,
    fact_adres:    [a.address1, a.address2].filter(Boolean).join(' ') || null,
    fact_postcode: a.zip ?? null,
    fact_plaats:   a.city ?? null,
    fact_land:     a.country_code ?? null,
  }
}

// ─── Hulpfuncties ─────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function afleverdatumVoor(order) {
  // Zoek in note_attributes naar gewenste leverdatum
  for (const attr of order.note_attributes ?? []) {
    if (/afleverdatum|leverdatum|delivery.?date/i.test(attr.name)) {
      const nlM = attr.value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
      if (nlM) return `${nlM[3]}-${nlM[2].padStart(2,'0')}-${nlM[1].padStart(2,'0')}`
      if (/^\d{4}-\d{2}-\d{2}$/.test(attr.value)) return attr.value
    }
  }
  // Standaard: orderdatum + 7 dagen
  const d = new Date(order.created_at)
  d.setDate(d.getDate() + 7)
  return d.toISOString().slice(0, 10)
}

// ─── Hoofd-importlogica ───────────────────────────────────────────────────────

async function importOrder(order) {
  // Idempotentie-check
  const bestaand = await supabaseRest(
    `/rest/v1/orders?bron_systeem=eq.shopify&bron_order_id=eq.${order.id}&select=order_nr&limit=1`
  )
  if (bestaand?.length > 0) {
    return { status: 'existing', order_nr: bestaand[0].order_nr }
  }

  // Debiteur matchen
  const debiteur = await matchDebiteur(order)
  if (!debiteur) {
    return { status: 'no_debiteur' }
  }

  // Orderregels verwerken
  const regels = []
  let matched = 0, unmatched = 0

  for (const item of order.line_items ?? []) {
    const m = await matchProduct(item)
    if (m.artikelnr) matched++; else unmatched++

    let maatwerk_lengte_cm = null
    let maatwerk_breedte_cm = null
    const afmM = (item.variant_title ?? '').match(AFM_RE)
    if (afmM) {
      maatwerk_lengte_cm = parseInt(afmM[1], 10)
      maatwerk_breedte_cm = parseInt(afmM[2], 10)
    }

    const omschrijving = m.artikelnr
      ? [item.title, item.variant_title].filter(Boolean).join(' — ')
      : `[UNMATCHED] ${[item.title, item.variant_title].filter(Boolean).join(' — ') || item.sku || 'onbekend'}`

    const prijs = parseFloat(item.price ?? '0') || null
    const aantal = item.quantity ?? 1

    regels.push({
      artikelnr: m.artikelnr,
      omschrijving,
      omschrijving_2: item.variant_title ?? null,
      orderaantal: aantal,
      te_leveren: aantal,
      prijs,
      korting_pct: 0,
      bedrag: prijs != null ? Math.round(prijs * aantal * 100) / 100 : null,
      gewicht_kg: item.grams ? Math.round(item.grams / 10) / 100 : null,
      is_maatwerk: false,
      maatwerk_kwaliteit_code: null,
      maatwerk_kleur_code: null,
      maatwerk_lengte_cm,
      maatwerk_breedte_cm,
    })
  }

  // Verzendkosten als aparte regel
  for (const sl of order.shipping_lines ?? []) {
    const bedrag = parseFloat(sl.price ?? '0') || 0
    if (bedrag > 0) {
      regels.push({
        artikelnr: 'VERZEND',
        omschrijving: sl.title ?? 'Verzendkosten',
        omschrijving_2: null,
        orderaantal: 1, te_leveren: 1,
        prijs: bedrag, korting_pct: 0, bedrag,
        gewicht_kg: null, is_maatwerk: false,
        maatwerk_kwaliteit_code: null, maatwerk_kleur_code: null,
        maatwerk_lengte_cm: null, maatwerk_breedte_cm: null,
      })
    }
  }

  const shopDomain = SHOP_DOMAIN
  const orderdatum = order.created_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)

  const header = {
    debiteur_nr: debiteur.nr,
    klant_referentie: order.name, // "#1001"
    orderdatum,
    afleverdatum: afleverdatumVoor(order),
    ...adresUit(order.shipping_address ?? order.billing_address),
    ...factuuradrseUit(order.billing_address),
    bron_systeem: 'shopify',
    bron_shop: shopDomain,
    bron_order_id: String(order.id),
  }

  if (DRY_RUN) {
    return { status: 'dry', debiteur: debiteur.nr, bron: debiteur.bron, matched, unmatched }
  }

  const rpc = await supabaseRest('/rest/v1/rpc/create_webshop_order', {
    method: 'POST',
    body: JSON.stringify({ p_header: header, p_regels: regels }),
  })
  const r = Array.isArray(rpc) ? rpc[0] : rpc
  return {
    status: r?.was_existing ? 'existing' : 'created',
    order_nr: r?.order_nr,
    debiteur: debiteur.nr,
    bron: debiteur.bron,
    matched,
    unmatched,
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Shopify bulk-import — orders vanaf ${SINCE_DATE}`)
  console.log(`Shop: ${SHOP_DOMAIN}${DRY_RUN ? ' [DRY_RUN]' : ''}`)
  console.log('─'.repeat(60))

  const stats = { totaal: 0, created: 0, existing: 0, no_debiteur: 0, errors: 0 }

  for await (const order of fetchAllOrders()) {
    stats.totaal++
    try {
      const result = await importOrder(order)

      if (result.status === 'existing') {
        if (VERBOSE) console.log(`  SKIP  ${order.name} → ${result.order_nr} (al aanwezig)`)
        stats.existing++
      } else if (result.status === 'no_debiteur') {
        console.warn(`  FAIL  ${order.name} — geen debiteur gevonden (bedrijf: "${order.billing_address?.company ?? order.company?.name ?? '-'}", email: "${order.email ?? '-'}")`)
        stats.no_debiteur++
      } else if (result.status === 'dry') {
        console.log(`  DRY   ${order.name} — deb=${result.debiteur}(${result.bron}) matched=${result.matched} unmatched=${result.unmatched}`)
        stats.created++
      } else {
        console.log(`  ✓     ${order.name} → ${result.order_nr} deb=${result.debiteur}(${result.bron}) matched=${result.matched} unmatched=${result.unmatched}`)
        stats.created++
      }
    } catch (err) {
      console.error(`  FOUT  ${order.name}:`, err.message)
      stats.errors++
    }

    // Korte pauze om Shopify rate limit te respecteren
    await sleep(250)
  }

  console.log('─'.repeat(60))
  console.log(`Klaar: ${stats.totaal} orders — geïmporteerd: ${stats.created}, al aanwezig: ${stats.existing}, geen debiteur: ${stats.no_debiteur}, fouten: ${stats.errors}`)
}

await main()
