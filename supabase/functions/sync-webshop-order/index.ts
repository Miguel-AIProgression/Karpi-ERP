// Supabase Edge Function: sync-webshop-order
//
// Twee modi:
//   webhook  → Lightspeed stuurt POST met x-signature bij orders/paid
//   import   → cron roept aan met ?mode=import, haalt zelf orders op via API
//
// Deploy met --no-verify-jwt.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient as createSupabase } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  createClient as createLightspeed,
  extractShippingAddress,
  collectExtraTexts,
  type LightspeedShop,
  type LightspeedOrderRow,
} from '../_shared/lightspeed-client.ts'
import { verifyLightspeedSignature } from '../_shared/lightspeed-verify.ts'
import { matchProduct } from '../_shared/product-matcher.ts'

const SHOPS: LightspeedShop[] = ['nl', 'de']
const PAGE_LIMIT = 250

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-signature',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

async function fetchFactuuradres(
  supabase: ReturnType<typeof createSupabase>,
  debiteurNr: number,
): Promise<{ fact_naam: string | null; fact_adres: string | null; fact_postcode: string | null; fact_plaats: string | null; fact_land: string | null }> {
  const { data } = await supabase
    .from('debiteuren')
    .select('naam, adres, postcode, plaats, land')
    .eq('debiteur_nr', debiteurNr)
    .maybeSingle()
  return {
    fact_naam: data?.naam ?? null,
    fact_adres: data?.adres ?? null,
    fact_postcode: data?.postcode ?? null,
    fact_plaats: data?.plaats ?? null,
    fact_land: data?.land ?? 'NL',
  }
}

async function fetchKarpiPrijsEnGewicht(
  supabase: ReturnType<typeof createSupabase>,
  artikelnr: string,
  prijslijstNr: string,
): Promise<{ prijs: number | null; gewicht: number | null }> {
  const { data } = await supabase
    .from('prijslijst_regels')
    .select('prijs, gewicht')
    .eq('prijslijst_nr', prijslijstNr)
    .eq('artikelnr', artikelnr)
    .maybeSingle()
  return { prijs: data?.prijs ?? null, gewicht: data?.gewicht ?? null }
}

async function buildRegels(
  supabase: ReturnType<typeof createSupabase>,
  rows: LightspeedOrderRow[],
  debiteurNr: number,
  prijslijstNr: string,
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

    const karpi = match.artikelnr
      ? await fetchKarpiPrijsEnGewicht(supabase, match.artikelnr, prijslijstNr)
      : null
    const prijs = karpi?.prijs ?? row.priceIncl ?? null
    const aantal = row.quantityOrdered ?? 1

    // Probeer afmeting te parsen uit variantTitle of productTitle: "302x166" of "302 x 166"
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
      orderaantal: aantal,
      te_leveren: aantal,
      prijs,
      korting_pct: 0,
      bedrag: (prijs ?? 0) * aantal,
      gewicht_kg: karpi?.gewicht ?? normalizeGewicht(row.weight),
      is_maatwerk: match.is_maatwerk ?? false,
      maatwerk_kwaliteit_code: match.maatwerk_kwaliteit_code ?? null,
      maatwerk_kleur_code: match.maatwerk_kleur_code ?? null,
      maatwerk_lengte_cm,
      maatwerk_breedte_cm,
    })
  }

  return { regels, matched, unmatched }
}

async function createOrder(
  supabase: ReturnType<typeof createSupabase>,
  shop: LightspeedShop,
  orderId: number | string,
  debiteurNr: number,
): Promise<{ order_nr: string | null; was_existing: boolean; matched: number; unmatched: number }> {
  const client = createLightspeed(shop)
  const [order, rows] = await Promise.all([
    client.getOrder(orderId),
    client.getOrderProducts(orderId),
  ])

  const { data: debiteur } = await supabase
    .from('debiteuren')
    .select('prijslijst_nr')
    .eq('debiteur_nr', debiteurNr)
    .maybeSingle()
  const prijslijstNr = debiteur?.prijslijst_nr ?? ''

  const { regels, matched, unmatched } = await buildRegels(supabase, rows, debiteurNr, prijslijstNr)
  const shipping = extractShippingAddress(order)
  const billing = await fetchFactuuradres(supabase, debiteurNr)

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

  if (error) throw new Error(error.message)

  const result = Array.isArray(data) && data.length > 0 ? data[0] : null
  const orderNr = result?.order_nr ?? null
  const wasExisting = result?.was_existing ?? false

  if (!wasExisting && orderNr) {
    await supabase.from('orders').update({
      afl_email: order.email ?? null,
      afl_telefoon: order.phone ?? null,
      opmerkingen: order.customerNote ?? null,
    }).eq('order_nr', orderNr)
  }

  return {
    order_nr: orderNr,
    was_existing: wasExisting,
    matched,
    unmatched,
  }
}

// ── IMPORT MODUS ─────────────────────────────────────────────────────────────
// Haalt zelf alle betaalde orders op via Lightspeed API vanaf vandaag.

async function cancelOrdersIfNeeded(
  supabase: ReturnType<typeof createSupabase>,
  shop: LightspeedShop,
  sindsdatum: string,
): Promise<number> {
  const client = createLightspeed(shop)
  let page = 1
  let totalCount: number | null = null
  let cancelled = 0

  while (true) {
    const { count, orders } = await client.listOrders({
      status: 'cancelled',
      createdAtMin: sindsdatum,
      limit: PAGE_LIMIT,
      page,
    })

    if (totalCount === null) totalCount = count
    if (orders.length === 0) break

    for (const order of orders) {
      // Niet annuleren als order al in productie is
      const { error } = await supabase
        .from('orders')
        .update({ status: 'Geannuleerd' })
        .eq('bron_order_id', String(order.id))
        .eq('bron_systeem', 'lightspeed')
        .in('status', ['Nieuw', 'Actie vereist', 'Wacht op picken', 'Wacht op voorraad'])

      if (!error) cancelled++
    }

    if (page * PAGE_LIMIT >= (totalCount ?? 0)) break
    page++
  }

  return cancelled
}

function getLastSyncDate(): string {
  return new Date().toISOString().slice(0, 10)
}

async function handleImport(
  supabase: ReturnType<typeof createSupabase>,
  debiteurNr: number,
): Promise<Response> {
  const sindsdatum = getLastSyncDate()
  const results = []

  for (const shop of SHOPS) {
    let imported = 0
    let skipped = 0
    let errors = 0
    let page = 1
    let totalCount: number | null = null

    try {
      const client = createLightspeed(shop)

      while (true) {
        const { count, orders } = await client.listOrders({
          status: 'processing_awaiting_shipment',
          createdAtMin: sindsdatum,
          limit: PAGE_LIMIT,
          page,
        })

        if (totalCount === null) totalCount = count
        if (orders.length === 0) break

        for (const order of orders) {
          if ((order.priceIncl ?? 0) <= 0) { skipped++; continue }

          try {
            const result = await createOrder(supabase, shop, order.id, debiteurNr)
            console.log(`[sync-webshop-order] import shop=${shop} order=${order.id} → ${result.order_nr} existing=${result.was_existing}`)
            if (result.was_existing) skipped++
            else imported++
          } catch (err) {
            console.error(`[sync-webshop-order] import shop=${shop} order=${order.id}:`, err instanceof Error ? err.message : err)
            errors++
          }
        }

        if (page * PAGE_LIMIT >= (totalCount ?? 0)) break
        page++
      }
    } catch (err) {
      console.error(`[sync-webshop-order] import shop=${shop} fatal:`, err instanceof Error ? err.message : err)
      errors++
    }

    results.push({ shop, imported, skipped, errors })
  }

  return json({ ok: true, mode: 'import', results })
}

// ── WEBHOOK MODUS ────────────────────────────────────────────────────────────
// Verwerkt inkomende Lightspeed webhook (orders/paid).

async function handleWebhook(
  req: Request,
  supabase: ReturnType<typeof createSupabase>,
  debiteurNr: number,
): Promise<Response> {
  const url = new URL(req.url)
  const shopParam = url.searchParams.get('shop') ?? req.headers.get('x-shop')
  const shop: LightspeedShop | null = shopParam === 'nl' || shopParam === 'de' ? shopParam : null
  if (!shop) return json({ error: 'Missing ?shop=nl|de' }, 400)

  const apiSecret = Deno.env.get(`LIGHTSPEED_${shop.toUpperCase()}_API_SECRET`)
  if (!apiSecret) return json({ error: `No API secret for shop ${shop}` }, 500)

  const rawPayload = await req.text()
  const signature = req.headers.get('x-signature')

  if (!verifyLightspeedSignature(rawPayload, signature, apiSecret)) {
    console.warn(`[sync-webshop-order] invalid signature shop=${shop}`)
    return json({ error: 'Invalid signature' }, 401)
  }

  let webhookBody: { order?: { id?: number | string } }
  try { webhookBody = JSON.parse(rawPayload) } catch { return json({ error: 'Invalid JSON' }, 400) }

  const orderId = webhookBody.order?.id
  if (!orderId) return json({ error: 'Missing order.id' }, 400)

  try {
    const result = await createOrder(supabase, shop, orderId, debiteurNr)
    console.log(`[sync-webshop-order] webhook shop=${shop} order=${orderId} → ${result.order_nr}`)
    return json({ order_nr: result.order_nr, was_existing: result.was_existing, matched: result.matched, unmatched: result.unmatched })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sync-webshop-order] webhook error:`, message)
    return json({ error: message }, 500)
  }
}

// ── ENTRYPOINT ────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const debiteurNr = Number(Deno.env.get('FLOORPASSION_DEBITEUR_NR') ?? '')
  if (!debiteurNr) return json({ error: 'FLOORPASSION_DEBITEUR_NR not configured' }, 500)

  const supabase = createSupabase(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const url = new URL(req.url)
  const mode = url.searchParams.get('mode')

  if (mode === 'import') return handleImport(supabase, debiteurNr)
  return handleWebhook(req, supabase, debiteurNr)
})
