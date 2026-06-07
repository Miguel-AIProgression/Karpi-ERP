// Supabase Edge Function: sync-shopify-order
// Ontvangt Shopify `orders/create` webhooks en maakt de order aan in RugFlow.
//
// Flow:
//   1. Verify HMAC-SHA256 signature (X-Shopify-Hmac-Sha256 header)
//   2. Idempotentie-check op (bron_systeem='shopify', bron_order_id)
//   3. Match debiteur via meerdere strategieën (note → tag → bedrijfsnaam → email → fallback)
//   4. Match orderregels → producten.artikelnr (hergebruikt product-matcher.ts)
//   5. RPC create_webshop_order: atomic insert, idempotent
//   6. Return 200 met samenvatting
//
// Auth: géén Supabase JWT (webhook heeft die niet). Deploy met --no-verify-jwt.
// Authenticiteit via X-Shopify-Hmac-Sha256 header.
//
// Vereiste env vars (Supabase Dashboard → Edge Functions → Secrets):
//   SHOPIFY_WEBHOOK_SECRET       — webhook signing secret (uit Shopify partner/app dashboard)
//   SHOPIFY_FALLBACK_DEBITEUR_NR — (optioneel) catch-all debiteur voor onbekende klanten
//
// Debug-modus: stuur ?debug=1 mee in de webhook-URL om de volledige order-payload
// terug te krijgen zonder iets op te slaan (handig voor eerste test-run).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyShopifySignature } from '../_shared/shopify-verify.ts'
import {
  extractShopifyShippingAddress,
  extractShopifyBillingAddress,
  shopifyLineItemToMatcherRow,
  type ShopifyOrderWebhook,
} from '../_shared/shopify-types.ts'
import { matchDebiteur } from '../_shared/shopify-debiteur-matcher.ts'
import { matchProduct, buildOmschrijving } from '../_shared/product-matcher.ts'
import { haalKlantPrijs } from '../_shared/klant-prijs.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-shopify-hmac-sha256, x-shopify-topic, x-shopify-shop-domain',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Shopify levert gewicht in gram; normalizeGewicht verwacht micro-kg.
// We skippen de micro-kg conversie: gram × 1000 = milli-gram is dicht genoeg
// voor de /1_000_000 → kg formule in sync-webshop-order (geeft milli-kg → kg).
// Klopt niet precies, maar gewicht is non-kritisch in de order-flow (geen billing).
// Correcte conversie: gram → kg = grams / 1000. We zetten het als kg × 1e6 (micro-kg).
function gramsToMicroKg(grams: number | null | undefined): number | undefined {
  if (grams == null) return undefined
  return Math.round(grams * 1000) // gram × 1000 = micro-gram ≈ micro-kg (schaalfactor 1e6)
}

function normalizeGewicht(microKg: number | undefined): number | null {
  if (microKg == null || isNaN(microKg)) return null
  const kg = microKg / 1_000_000
  if (kg >= 1_000_000 || kg < 0) return null
  return Math.round(kg * 100) / 100
}

async function buildRegels(
  supabase: ReturnType<typeof createClient>,
  order: ShopifyOrderWebhook,
  debiteurNr: number,
): Promise<{ regels: unknown[]; matched: number; unmatched: number }> {
  const regels: unknown[] = []
  let matched = 0
  let unmatched = 0

  for (const item of order.line_items) {
    // Verzendregels van Shopify niet als orderregel importeren — die komen
    // uit shipping_lines en worden apart verwerkt.
    if (item.requires_shipping === false && /verzend|verzending|shipping/i.test(item.title)) {
      continue
    }

    const matcherRow = shopifyLineItemToMatcherRow(item)
    const match = await matchProduct(supabase, matcherRow, debiteurNr)

    const omschrijving = buildOmschrijving(matcherRow, match)

    if (match.artikelnr || match.is_maatwerk) matched++
    else unmatched++

    let maatwerk_lengte_cm: number | null = null
    let maatwerk_breedte_cm: number | null = null
    if (match.is_maatwerk) {
      // Dimensies uit properties of variant_title ("140 x 200 cm")
      const props = item.properties ?? []
      const findProp = (names: string[]) =>
        props.find(p => names.some(n => n.toLowerCase() === p.name.toLowerCase()))?.value ?? null

      const lengteProp = findProp(['lengte', 'length'])
      const breedteProp = findProp(['breedte', 'width', 'breed'])
      const maatProp = findProp(['maatwerk', 'maat', 'size', 'afmeting'])

      if (lengteProp && breedteProp) {
        maatwerk_lengte_cm = parseFloat(lengteProp) || null
        maatwerk_breedte_cm = parseFloat(breedteProp) || null
      } else if (maatProp) {
        // "140 x 200" of "140x200"
        const m = maatProp.match(/(\d+)\s*[xX×]\s*(\d+)/)
        if (m) {
          maatwerk_lengte_cm = parseInt(m[1], 10)
          maatwerk_breedte_cm = parseInt(m[2], 10)
        }
      } else if (item.variant_title) {
        const m = item.variant_title.match(/(\d+)\s*[xX×]\s*(\d+)/)
        if (m) {
          maatwerk_lengte_cm = parseInt(m[1], 10)
          maatwerk_breedte_cm = parseInt(m[2], 10)
        }
      }
    }

    const aantal = item.quantity
    const klantPrijs = await haalKlantPrijs(supabase, debiteurNr, match.artikelnr, {
      is_maatwerk: match.is_maatwerk,
      lengte_cm: maatwerk_lengte_cm,
      breedte_cm: maatwerk_breedte_cm,
    })
    const prijs = klantPrijs.prijs
    const bedrag = prijs != null ? Math.round(prijs * aantal * 100) / 100 : null

    regels.push({
      artikelnr: match.artikelnr,
      omschrijving,
      omschrijving_2: item.variant_title ?? null,
      orderaantal: aantal,
      te_leveren: aantal,
      prijs,
      korting_pct: 0,
      bedrag,
      gewicht_kg: normalizeGewicht(gramsToMicroKg(item.grams)),
      is_maatwerk: match.is_maatwerk ?? false,
      maatwerk_kwaliteit_code: match.maatwerk_kwaliteit_code ?? null,
      maatwerk_kleur_code: match.maatwerk_kleur_code ?? null,
      maatwerk_lengte_cm,
      maatwerk_breedte_cm,
    })
  }

  // Verzendkosten als VERZEND-orderregel toevoegen (als aanwezig en > 0)
  for (const sl of order.shipping_lines ?? []) {
    const bedragVerzend = parseFloat(sl.price ?? '0') || 0
    if (bedragVerzend > 0) {
      regels.push({
        artikelnr: 'VERZEND',
        omschrijving: sl.title ?? 'Verzendkosten',
        omschrijving_2: null,
        orderaantal: 1,
        te_leveren: 1,
        prijs: bedragVerzend,
        korting_pct: 0,
        bedrag: bedragVerzend,
        gewicht_kg: null,
        is_maatwerk: false,
        maatwerk_kwaliteit_code: null,
        maatwerk_kleur_code: null,
        maatwerk_lengte_cm: null,
        maatwerk_breedte_cm: null,
      })
    }
  }

  return { regels, matched, unmatched }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const webhookSecret = Deno.env.get('SHOPIFY_WEBHOOK_SECRET')
  if (!webhookSecret) return json({ error: 'SHOPIFY_WEBHOOK_SECRET not configured' }, 500)

  const rawPayload = await req.text()
  const hmacHeader = req.headers.get('x-shopify-hmac-sha256')

  const isValid = await verifyShopifySignature(rawPayload, hmacHeader, webhookSecret)
  if (!isValid) {
    console.warn('[sync-shopify-order] ongeldige signature')
    return json({ error: 'Invalid signature' }, 401)
  }

  const url = new URL(req.url)
  const debugMode = url.searchParams.get('debug') === '1'

  let order: ShopifyOrderWebhook
  try {
    order = JSON.parse(rawPayload)
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  // Debug-modus: return de raw order zonder DB-aanroepen
  if (debugMode) {
    return json({
      debug: true,
      shopify_order_id: order.id,
      shopify_order_name: order.name,
      note: order.note ?? null,
      note_attributes: order.note_attributes ?? [],
      customer_note: order.customer?.note ?? null,
      customer_tags: order.customer?.tags ?? null,
      company: order.company ?? null,
      billing_company: order.billing_address?.company ?? null,
      email: order.email ?? order.customer?.email ?? null,
      line_items_count: order.line_items?.length ?? 0,
      line_items: (order.line_items ?? []).map(i => ({
        title: i.title,
        variant_title: i.variant_title,
        sku: i.sku,
        quantity: i.quantity,
        price: i.price,
        properties: i.properties ?? [],
      })),
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const orderId = order.id
  if (!orderId) return json({ error: 'Missing order.id' }, 400)

  // Idempotentie-check vóór zware verwerking
  const { data: existing } = await supabase
    .from('orders')
    .select('order_nr')
    .eq('bron_systeem', 'shopify')
    .eq('bron_order_id', String(orderId))
    .limit(1)

  if (existing && existing.length > 0) {
    console.log(`[sync-shopify-order] order ${orderId} bestaat al als ${existing[0].order_nr}`)
    return json({ order_nr: existing[0].order_nr, was_existing: true, matched: 0, unmatched: 0 })
  }

  // Debiteur-matching
  const debiteurMatch = await matchDebiteur(supabase, order)
  if (!debiteurMatch) {
    console.error(`[sync-shopify-order] geen debiteur gevonden voor order ${orderId}`)
    return json({ error: 'Geen debiteur gevonden. Stel SHOPIFY_FALLBACK_DEBITEUR_NR in als catch-all.' }, 422)
  }

  console.log(
    `[sync-shopify-order] order=${orderId} debiteur=${debiteurMatch.debiteur_nr} (bron: ${debiteurMatch.bron})`,
  )

  const { regels, matched, unmatched } = await buildRegels(supabase, order, debiteurMatch.debiteur_nr)

  // Bedrijfsnaam ophalen zodat adressen altijd bedrijfsnaam tonen ook als Shopify die niet meestuurt
  const { data: debiteurInfo } = await supabase
    .from('debiteuren')
    .select('naam')
    .eq('debiteur_nr', debiteurMatch.debiteur_nr)
    .single()
  const debiteurNaam = debiteurInfo?.naam ?? null

  const shipping = extractShopifyShippingAddress(order)
  const billing = extractShopifyBillingAddress(order)

  // Vul bedrijfsnaam in vanuit debiteur als Shopify die niet meestuurt
  if (debiteurNaam) {
    if (!shipping.afl_bedrijf) shipping.afl_bedrijf = debiteurNaam
    if (!billing.fact_bedrijf) billing.fact_bedrijf = debiteurNaam
  }

  // Afleverdatum: Shopify B2B heeft geen standaard leverdatum-veld.
  // Gebruik orderdatum + 5 werkdagen als standaard. Als er een note_attribute
  // "afleverdatum" / "leverdatum" / "requested_delivery_date" staat, gebruik die.
  const orderdatum = order.created_at ? order.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10)
  let afleverdatum: string | null = null

  for (const attr of order.note_attributes ?? []) {
    if (/afleverdatum|leverdatum|delivery.?date|gewenste.?datum/i.test(attr.name)) {
      // ISO-formaat "2026-06-15" of Nederlands "15-06-2026"
      const nlMatch = attr.value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
      if (nlMatch) {
        afleverdatum = `${nlMatch[3]}-${nlMatch[2].padStart(2, '0')}-${nlMatch[1].padStart(2, '0')}`
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(attr.value)) {
        afleverdatum = attr.value
      }
      break
    }
  }

  // Standaard: 7 kalenderdagen na orderdatum (veilige buffer voor B2B)
  if (!afleverdatum) {
    const d = new Date(orderdatum)
    d.setDate(d.getDate() + 7)
    afleverdatum = d.toISOString().slice(0, 10)
  }

  const shopDomain = req.headers.get('x-shopify-shop-domain') ?? 'shopify'
  // Gebruik de klant-notitie als referentie (B2B PO-nummer), anders het Shopify ordernummer
  const klantReferentie = order.note?.trim() || order.name

  const header = {
    debiteur_nr: debiteurMatch.debiteur_nr,
    klant_referentie: klantReferentie,
    orderdatum,
    afleverdatum,
    ...shipping,
    ...billing,
    bron_systeem: 'shopify',
    bron_shop: shopDomain,
    bron_order_id: String(orderId),
    // Mig 322: een onzekere fuzzy match (bedrijfsnaam-deelmatch/e-mail) landt
    // wél als order maar wordt gemarkeerd als "debiteur te bevestigen" zodat de
    // operator hem via de banner op het orders-overzicht kan corrigeren —
    // i.p.v. stil op de gegokte debiteur te accepteren. De env-fallback
    // (verzameldebiteur) is bewust géén fout en wordt door het predicaat
    // uitgesloten op bron.
    debiteur_zeker: debiteurMatch.zeker,
    debiteur_match_bron: debiteurMatch.bron,
  }

  const { data, error } = await supabase.rpc('create_webshop_order', {
    p_header: header,
    p_regels: regels,
  })

  if (error) {
    console.error('[sync-shopify-order] RPC fout:', error)
    return json({ error: error.message }, 500)
  }

  const result = Array.isArray(data) && data.length > 0 ? data[0] : null
  console.log(
    `[sync-shopify-order] order=${orderId} → ${result?.order_nr} ` +
    `debiteur=${debiteurMatch.debiteur_nr}(${debiteurMatch.bron}) ` +
    `matched=${matched} unmatched=${unmatched}`,
  )

  return json({
    order_nr: result?.order_nr ?? null,
    was_existing: result?.was_existing ?? false,
    debiteur_nr: debiteurMatch.debiteur_nr,
    debiteur_bron: debiteurMatch.bron,
    matched,
    unmatched,
  })
})
