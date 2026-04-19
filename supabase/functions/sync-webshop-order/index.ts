// Supabase Edge Function: sync-webshop-order
// Ontvangt Lightspeed eCom `orders/paid` webhooks en maakt de order aan
// in RugFlow onder verzameldebiteur Floorpassion (zie migratie 091 + 092).
//
// Flow:
//   1. Parse raw body + verify MD5 signature (shop-specifiek secret)
//   2. Fetch volledige order uit Lightspeed REST API
//   3. Match orderregels → producten.artikelnr (SKU/EAN/omschrijving)
//   4. RPC create_webshop_order: atomic insert, idempotent op bron_order_id
//   5. Return 200 met samenvatting
//
// Auth: géén Supabase JWT (webhook heeft die niet). Deploy met
// `--no-verify-jwt`. Authenticiteit via x-signature header.
//
// Plan: docs/superpowers/plans/2026-04-17-lightspeed-webshop-orders.md

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient as createSupabase } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  createClient as createLightspeed,
  extractShippingAddress,
  extractBillingAddress,
  type LightspeedShop,
  type LightspeedOrder,
  type LightspeedOrderRow,
} from '../_shared/lightspeed-client.ts'
import { verifyLightspeedSignature } from '../_shared/lightspeed-verify.ts'
import { matchProduct, buildOmschrijving } from '../_shared/product-matcher.ts'

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

function parseShop(req: Request): LightspeedShop | null {
  const url = new URL(req.url)
  const shop = url.searchParams.get('shop') ?? req.headers.get('x-shop')
  if (shop === 'nl' || shop === 'de') return shop
  return null
}

function secretFor(shop: LightspeedShop): string | null {
  return Deno.env.get(`LIGHTSPEED_${shop.toUpperCase()}_API_SECRET`) ?? null
}

function bronShopFor(shop: LightspeedShop): string {
  return shop === 'nl' ? 'floorpassion_nl' : 'floorpassion_de'
}

// Lightspeed levert gewicht in micro-kg (int, schaalfactor 1e6).
// 4210000 → 4.21 kg. Conversie naar kg + begrenzing op NUMERIC(8,2).
function normalizeGewicht(raw: number | undefined): number | null {
  if (raw == null || Number.isNaN(raw)) return null
  const kg = raw / 1_000_000
  if (kg >= 1_000_000 || kg < 0) return null
  return Math.round(kg * 100) / 100
}

async function buildRegels(
  supabase: ReturnType<typeof createSupabase>,
  rows: LightspeedOrderRow[],
): Promise<{ regels: unknown[]; matched: number; unmatched: number }> {
  const regels: unknown[] = []
  let matched = 0
  let unmatched = 0

  for (const row of rows) {
    const match = await matchProduct(supabase, row)
    const omschrijving = buildOmschrijving(row, match)

    if (match.artikelnr) matched++
    else unmatched++

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
    })
  }

  return { regels, matched, unmatched }
}

async function fetchCompleteOrder(
  shop: LightspeedShop,
  orderId: number | string,
): Promise<{ order: LightspeedOrder; rows: LightspeedOrderRow[] }> {
  const client = createLightspeed(shop)
  const [order, rows] = await Promise.all([
    client.getOrder(orderId),
    client.getOrderProducts(orderId),
  ])
  return { order, rows }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const shop = parseShop(req)
  if (!shop) return json({ error: 'Missing ?shop=nl|de' }, 400)

  const secret = secretFor(shop)
  if (!secret) return json({ error: `No API secret configured for shop ${shop}` }, 500)

  const rawPayload = await req.text()
  const signature = req.headers.get('x-signature')

  if (!verifyLightspeedSignature(rawPayload, signature, secret)) {
    console.warn(`[sync-webshop-order] invalid signature shop=${shop}`)
    return json({ error: 'Invalid signature' }, 401)
  }

  let webhookBody: { order?: { id?: number | string; number?: number } }
  try {
    webhookBody = JSON.parse(rawPayload)
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const orderId = webhookBody.order?.id
  if (!orderId) return json({ error: 'Missing order.id in webhook' }, 400)

  const debiteurNr = Number(Deno.env.get('FLOORPASSION_DEBITEUR_NR') ?? '')
  if (!debiteurNr) return json({ error: 'FLOORPASSION_DEBITEUR_NR not configured' }, 500)

  const supabase = createSupabase(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  try {
    // Idempotentie-check vóór Lightspeed-fetch: voorkomt onnodige API-calls
    // (en dus rate-limit hits) bij Lightspeed's retry-mechanisme.
    const { data: existing } = await supabase
      .from('orders')
      .select('order_nr')
      .eq('bron_systeem', 'lightspeed')
      .eq('bron_order_id', String(orderId))
      .limit(1)
    if (existing && existing.length > 0) {
      console.log(
        `[sync-webshop-order] shop=${shop} order=${orderId} already exists as ${existing[0].order_nr} — skip fetch`,
      )
      return json({
        order_nr: existing[0].order_nr,
        was_existing: true,
        matched: 0,
        unmatched: 0,
      })
    }

    const { order, rows } = await fetchCompleteOrder(shop, orderId)
    const { regels, matched, unmatched } = await buildRegels(supabase, rows)

    const shipping = extractShippingAddress(order)
    const billing = extractBillingAddress(order)

    const header = {
      debiteur_nr: debiteurNr,
      klant_referentie: `Floorpassion #${order.number}`,
      orderdatum: order.createdAt ? order.createdAt.slice(0, 10) : null,
      afleverdatum: null,
      ...shipping,
      ...billing,
      bron_systeem: 'lightspeed',
      bron_shop: bronShopFor(shop),
      bron_order_id: String(order.id),
    }

    const { data, error } = await supabase.rpc('create_webshop_order', {
      p_header: header,
      p_regels: regels,
    })

    if (error) {
      console.error(`[sync-webshop-order] RPC error:`, error)
      return json({ error: error.message }, 500)
    }

    const result = Array.isArray(data) && data.length > 0 ? data[0] : null
    console.log(
      `[sync-webshop-order] shop=${shop} order=${order.id} → ${result?.order_nr} ` +
        `(existing=${result?.was_existing}) matched=${matched} unmatched=${unmatched}`,
    )

    return json({
      order_nr: result?.order_nr ?? null,
      was_existing: result?.was_existing ?? false,
      matched,
      unmatched,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sync-webshop-order] shop=${shop} error:`, message)
    return json({ error: message }, 500)
  }
})
