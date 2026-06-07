// Supabase Edge Function: sync-shopify-orders-poll
//
// Geplande, zelf-helende Shopify-ordersync via de Admin REST API — vervangt
// de afhankelijkheid van de fragiele `orders/create`-webhook (sync-shopify-order).
//
// Waarom: de webhook bleek al sinds 15 mei 2026 niet meer te vuren (0 invocations),
// vermoedelijk verloren bij een shop-domeinwissel of credential-rotatie. Orders
// #5562-#5577 zijn daardoor nooit ingeladen. Twee eerdere fixes verbeterden
// matching-logica in dode code — het probleem zat in de levering, niet de verwerking.
//
// Aanpak: poll Shopify `GET /orders.json?created_at_min=<watermark>` op een
// pg_cron-schema (elke 10 min, mig 323). Per order: processShopifyOrder()
// (gedeeld met de webhook-handler). Watermark schuift alleen vooruit bij succes
// → gemiste/mislukte runs worden door de volgende run automatisch ingehaald.
// Elke run wordt gelogd in `shopify_sync_runs` (audit-trail, voedt monitoring
// in RugFlow — analoog aan de EDI "Te koppelen"-banner).
//
// Aanroep: POST (geen body), typisch vanuit pg_cron. Auth: CRON_TOKEN header
// of Supabase service-role JWT — zelfde patroon als poll-email-orders.
//
// Vereiste Supabase secrets:
//   SHOPIFY_ACCESS_TOKEN  — Admin API access token (shpat_...)
//   SHOPIFY_SHOP_DOMAIN   — bijv. karpi-group.myshopify.com
//   CRON_TOKEN            — gedeeld met pg_cron voor authenticatie

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { type ShopifyOrderWebhook } from '../_shared/shopify-types.ts'
import { processShopifyOrder, type ProcessResult } from '../_shared/shopify-order-processor.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SHOPIFY_ACCESS_TOKEN = Deno.env.get('SHOPIFY_ACCESS_TOKEN')
const SHOPIFY_SHOP_DOMAIN  = Deno.env.get('SHOPIFY_SHOP_DOMAIN')
const CRON_TOKEN           = Deno.env.get('CRON_TOKEN') ?? ''
const SHOPIFY_API_VERSION  = '2024-04'

const PAGE_LIMIT = 50

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface OrdersPage {
  orders: ShopifyOrderWebhook[]
  nextPageInfo: string | null
}

// Shopify Admin REST: paginering via Link-header met page_info-token (cursor-based)
async function fetchOrdersPage(
  createdAtMin: string,
  pageInfo: string | null,
): Promise<OrdersPage> {
  const url = new URL(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders.json`)
  url.searchParams.set('limit', String(PAGE_LIMIT))
  // Shopify-regel: zodra page_info is meegegeven mogen er GEEN andere filterparams
  // (status, created_at_min, order, ...) meegestuurd worden — anders 400.
  //
  // created_at_min (NIET updated_at_min): de oude webhook luisterde op `orders/create`
  // — alleen NIEUWE orders, geen latere wijzigingen. updated_at_min trekt ook
  // jaren-oude orders binnen die recent zijn aangepast (refund, notitie, fulfillment),
  // en die zijn nooit voor RugFlow bedoeld geweest (vandaar "Geen debiteur gevonden").
  // created_at_min houdt het gedrag gelijk aan de oude webhook, maar dan zelf-helend.
  if (pageInfo) {
    url.searchParams.set('page_info', pageInfo)
  } else {
    url.searchParams.set('status', 'any')
    url.searchParams.set('created_at_min', createdAtMin)
    url.searchParams.set('order', 'created_at asc')
  }

  const res = await fetch(url.toString(), {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN!,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Shopify GET orders.json: ${res.status} ${t.slice(0, 300)}`)
  }

  const body = await res.json() as { orders: ShopifyOrderWebhook[] }

  // Link: <...page_info=xyz>; rel="next"
  const link = res.headers.get('Link') ?? res.headers.get('link')
  let nextPageInfo: string | null = null
  if (link) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/)
    if (match) {
      const nextUrl = new URL(match[1])
      nextPageInfo = nextUrl.searchParams.get('page_info')
    }
  }

  return { orders: body.orders ?? [], nextPageInfo }
}

// Max. aantal orders dat één run verwerkt. Verwerking (debiteur-matching,
// product-matching, prijs-lookups, RPC) kost tijd per order — bij een lege
// of oude watermark kunnen er honderden orders openstaan. Een hard cap houdt
// elke run ruim binnen de edge-function idle-timeout (150s); de resterende
// orders pakt de volgende cron-tick (10 min later) vanaf de bijgewerkte
// watermark gewoon op — zelf-helend, geen orders worden overgeslagen.
const MAX_ORDERS_PER_RUN = 25

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const cronHeader = req.headers.get('x-cron-token') ?? ''
  if (cronHeader !== CRON_TOKEN && !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!SHOPIFY_ACCESS_TOKEN || !SHOPIFY_SHOP_DOMAIN) {
    return json({ error: 'SHOPIFY_ACCESS_TOKEN / SHOPIFY_SHOP_DOMAIN niet geconfigureerd' }, 500)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Watermark ophalen
  const { data: wmRow, error: wmErr } = await supabase
    .from('shopify_sync_watermark')
    .select('watermark')
    .eq('id', 1)
    .single()
  if (wmErr || !wmRow) {
    return json({ error: `Kan watermark niet lezen: ${wmErr?.message ?? 'geen rij'}` }, 500)
  }
  const watermarkVoor = wmRow.watermark as string

  // Run-rij aanmaken
  const { data: runRow, error: runErr } = await supabase
    .from('shopify_sync_runs')
    .insert({ shop_domain: SHOPIFY_SHOP_DOMAIN, watermark_voor: watermarkVoor, status: 'lopend' })
    .select('id')
    .single()
  if (runErr || !runRow) {
    return json({ error: `Kan sync-run niet aanmaken: ${runErr?.message}` }, 500)
  }
  const runId = runRow.id as number

  async function schuifWatermarkOp(nieuw: string) {
    await supabase
      .from('shopify_sync_watermark')
      .update({ watermark: nieuw, bijgewerkt_op: new Date().toISOString() })
      .eq('id', 1)
  }

  try {
    const resultaten: Array<{ shopify_order: string; order_nr: string | null; actie: string; fout?: string }> = []
    let aangemaakt = 0
    let overgeslagen = 0
    let fouten = 0
    let opgehaald = 0
    let nieuweWatermark = watermarkVoor
    let pageInfo: string | null = null
    let gestopt = false

    pageLoop: do {
      const { orders, nextPageInfo } = await fetchOrdersPage(watermarkVoor, pageInfo)
      pageInfo = nextPageInfo
      opgehaald += orders.length

      for (const order of orders) {
        if (resultaten.length >= MAX_ORDERS_PER_RUN) {
          gestopt = true
          break pageLoop
        }

        const naam = order.name ?? `#${order.id}`
        try {
          const result: ProcessResult = await processShopifyOrder(supabase, order, SHOPIFY_SHOP_DOMAIN)

          if (result.skipped_reason) {
            fouten++
            resultaten.push({ shopify_order: naam, order_nr: null, actie: 'fout', fout: result.skipped_reason })
            console.error(`[sync-shopify-orders-poll] ${naam} → fout: ${result.skipped_reason}`)
          } else if (result.was_existing) {
            overgeslagen++
            resultaten.push({ shopify_order: naam, order_nr: result.order_nr, actie: 'overgeslagen (bestond al)' })
          } else {
            aangemaakt++
            resultaten.push({ shopify_order: naam, order_nr: result.order_nr, actie: 'aangemaakt' })
            console.log(`[sync-shopify-orders-poll] ${naam} → ${result.order_nr} aangemaakt`)
          }

          // Watermark schuift door bij elke succesvol AFGEHANDELDE order (incl. "bestond al"
          // en skips-met-reden zoals "geen debiteur") en wordt direct gepersisteerd —
          // zodat een timeout halverwege geen herhaalde verwerking veroorzaakt.
          if (order.created_at && order.created_at > nieuweWatermark) {
            nieuweWatermark = order.created_at
            await schuifWatermarkOp(nieuweWatermark)
          }
        } catch (err) {
          fouten++
          const fout = err instanceof Error ? err.message : String(err)
          resultaten.push({ shopify_order: naam, order_nr: null, actie: 'fout', fout })
          console.error(`[sync-shopify-orders-poll] FOUT ${naam}:`, fout)
          // Bij een onverwachte (RPC/db-)fout NIET de watermark voorbij deze order schuiven —
          // zodat de volgende run het opnieuw probeert (zelf-helend).
          gestopt = true
          break pageLoop
        }
      }
    } while (pageInfo)

    await supabase
      .from('shopify_sync_runs')
      .update({
        afgerond_op: new Date().toISOString(),
        status: fouten > 0 && aangemaakt === 0 && overgeslagen === 0 ? 'fout' : 'ok',
        opgehaald,
        aangemaakt,
        overgeslagen,
        fouten,
        watermark_na: nieuweWatermark,
        details: resultaten,
      })
      .eq('id', runId)

    return json({
      run_id: runId,
      opgehaald,
      aangemaakt,
      overgeslagen,
      fouten,
      watermark_na: nieuweWatermark,
      vervolg_nodig: gestopt && pageInfo != null,
      details: resultaten,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sync-shopify-orders-poll] fatale fout:', message)
    await supabase
      .from('shopify_sync_runs')
      .update({ afgerond_op: new Date().toISOString(), status: 'fout', foutmelding: message })
      .eq('id', runId)
    return json({ error: message }, 500)
  }
})
