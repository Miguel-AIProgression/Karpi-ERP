// Supabase Edge Function: import-lightspeed-orders
//
// Haalt actief betaalde orders op uit Lightspeed eCom API en importeert
// ze in RugFlow. Bedoeld om via pg_cron elke 2 minuten te draaien.
//
// Filters:
//   - paymentStatus = paid
//   - status != cancelled
//   - priceIncl > 0
//   - createdAt >= vandaag (of laatste sync timestamp)
//
// Idempotent: create_webshop_order RPC skipt orders die al bestaan op bron_order_id.
// Deploy met --no-verify-jwt (wordt intern aangeroepen door cron).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient as createSupabase } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  createClient as createLightspeed,
  extractShippingAddress,
  extractBillingAddress,
  collectExtraTexts,
  type LightspeedShop,
  type LightspeedOrder,
  type LightspeedOrderRow,
} from '../_shared/lightspeed-client.ts'
import { matchProduct } from '../_shared/product-matcher.ts'

const SHOPS: LightspeedShop[] = ['nl', 'de']
const PAGE_LIMIT = 250

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function bronShopFor(shop: LightspeedShop): string {
  return shop === 'nl' ? 'floorpassion_nl' : 'floorpassion_de'
}

function normalizeGewicht(raw: number | undefined): number | null {
  if (raw == null || Number.isNaN(raw)) return null
  const kg = raw / 1_000  // Lightspeed weight is in grams
  if (kg >= 1_000_000 || kg < 0) return null
  return Math.round(kg * 100) / 100
}

// Vandaag in ISO formaat (YYYY-MM-DD) als startdatum voor import
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

async function buildRegels(
  supabase: ReturnType<typeof createSupabase>,
  rows: LightspeedOrderRow[],
  debiteurNr: number,
): Promise<{ regels: unknown[]; matched: number; unmatched: number }> {
  const regels: unknown[] = []
  let matched = 0
  let unmatched = 0

  for (const row of rows) {
    const match = await matchProduct(supabase, row, debiteurNr)
    const omschrijvingBase = [row.productTitle, row.variantTitle].filter(Boolean).join(' — ')
    const isHerkend = match.artikelnr != null || match.is_maatwerk
    const omschrijving = isHerkend
      ? omschrijvingBase
      : `[UNMATCHED] ${omschrijvingBase || row.articleCode || row.sku || 'onbekend'}`

    if (isHerkend) matched++
    else unmatched++

    let maatwerk_lengte_cm: number | null = null
    let maatwerk_breedte_cm: number | null = null
    if (match.is_maatwerk) {
      const afmetingMatch = [
        row.variantTitle,
        row.productTitle,
        ...collectExtraTexts(row),
      ].join(' ').match(/(\d+)\s*[xX×]\s*(\d+)/)
      if (afmetingMatch) {
        maatwerk_lengte_cm = parseInt(afmetingMatch[1])
        maatwerk_breedte_cm = parseInt(afmetingMatch[2])
      }
    }

    regels.push({
      artikelnr: match.artikelnr,
      omschrijving,
      omschrijving_2: row.variantTitle ?? null,
      orderaantal: row.quantityOrdered ?? 1,
      te_leveren: row.quantityOrdered ?? 1,
      prijs: row.priceIncl ?? null,
      korting_pct: 0,
      bedrag: (row.priceIncl ?? 0) * (row.quantityOrdered ?? 1),
      gewicht_kg: normalizeGewicht(row.weight),
      is_maatwerk: match.is_maatwerk ?? false,
      maatwerk_kwaliteit_code: match.maatwerk_kwaliteit_code ?? null,
      maatwerk_kleur_code: match.maatwerk_kleur_code ?? null,
      maatwerk_vorm: match.maatwerk_vorm ?? null,
      maatwerk_lengte_cm,
      maatwerk_breedte_cm,
    })
  }

  return { regels, matched, unmatched }
}

async function importShop(
  shop: LightspeedShop,
  supabase: ReturnType<typeof createSupabase>,
  debiteurNr: number,
  createdAtMin: string,
): Promise<{ shop: LightspeedShop; imported: number; skipped: number; errors: number }> {
  const client = createLightspeed(shop)
  let page = 1
  let totalCount: number | null = null
  let imported = 0
  let skipped = 0
  let errors = 0

  while (true) {
    const { count, orders } = await client.listOrders({
      paymentStatus: 'paid',
      createdAtMin,
      limit: PAGE_LIMIT,
      page,
    })

    if (totalCount === null) totalCount = count
    if (orders.length === 0) break

    for (const order of orders) {
      // Skip geannuleerde en gratis orders
      if (order.status === 'cancelled') { skipped++; continue }
      if ((order.priceIncl ?? 0) <= 0) { skipped++; continue }

      try {
        const rows = await client.getOrderProducts(order.id)
        const { regels, matched, unmatched } = await buildRegels(supabase, rows, debiteurNr)

        const shipping = extractShippingAddress(order)
        const billing = extractBillingAddress(order)

        const header = {
          debiteur_nr: debiteurNr,
          klant_referentie: `Floorpassion #${order.number}`,
          orderdatum: order.createdAt ? order.createdAt.slice(0, 10) : null,
          afleverdatum: null,
          ...shipping,
          ...billing,
          afl_email: order.email ?? null,
          afl_telefoon: order.phone ?? null,
          opmerkingen: order.customerNote ?? null,
          bron_systeem: 'lightspeed',
          bron_shop: bronShopFor(shop),
          bron_order_id: String(order.id),
        }

        const { data, error } = await supabase.rpc('create_webshop_order', {
          p_header: header,
          p_regels: regels,
        })

        if (error) {
          console.error(`[import-lightspeed] shop=${shop} order=${order.id} RPC error:`, error.message)
          errors++
          continue
        }

        const result = Array.isArray(data) && data.length > 0 ? data[0] : null
        const wasExisting = result?.was_existing ?? false

        console.log(
          `[import-lightspeed] shop=${shop} order=${order.id} → ${result?.order_nr} ` +
          `existing=${wasExisting} matched=${matched} unmatched=${unmatched}`,
        )

        if (wasExisting) skipped++
        else imported++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[import-lightspeed] shop=${shop} order=${order.id} error:`, msg)
        errors++
      }
    }

    // Stop als we alle pagina's gehad hebben
    if (page * PAGE_LIMIT >= (totalCount ?? 0)) break
    page++
  }

  return { shop, imported, skipped, errors }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const debiteurNr = Number(Deno.env.get('FLOORPASSION_DEBITEUR_NR') ?? '')
  if (!debiteurNr) return json({ error: 'FLOORPASSION_DEBITEUR_NR not configured' }, 500)

  const supabase = createSupabase(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  // Optioneel: verwerk alleen bepaalde shops via ?shop=nl of body
  let shopsToProcess: LightspeedShop[] = SHOPS
  let createdAtMin = todayIso()
  try {
    const body = await req.json().catch(() => ({}))
    if (body?.shops && Array.isArray(body.shops)) {
      shopsToProcess = body.shops.filter((s: string) => SHOPS.includes(s as LightspeedShop)) as LightspeedShop[]
    }
    if (body?.created_at_min && typeof body.created_at_min === 'string') {
      createdAtMin = body.created_at_min
    }
  } catch { /* geen body, alle shops */ }

  const results = []
  for (const shop of shopsToProcess) {
    try {
      const result = await importShop(shop, supabase, debiteurNr, createdAtMin)
      results.push(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[import-lightspeed] shop=${shop} fatal:`, msg)
      results.push({ shop, imported: 0, skipped: 0, errors: 1, fatal: msg })
    }
  }

  const totaalImported = results.reduce((s, r) => s + r.imported, 0)
  console.log(`[import-lightspeed] klaar: ${totaalImported} nieuwe orders`)

  return json({ ok: true, results })
})
