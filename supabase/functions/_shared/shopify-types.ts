// Shopify Admin API types voor gebruik in edge functions.
// Gebaseerd op Shopify REST Admin API 2024-01 order-response.

export interface ShopifyAddress {
  first_name?: string | null
  last_name?: string | null
  name?: string | null
  company?: string | null
  address1?: string | null
  address2?: string | null
  zip?: string | null
  city?: string | null
  province?: string | null
  province_code?: string | null
  country?: string | null
  country_code?: string | null
  phone?: string | null
}

export interface ShopifyCustomer {
  id: number
  email?: string | null
  first_name?: string | null
  last_name?: string | null
  company?: string | null
  note?: string | null
  tags?: string | null // komma-gescheiden string
}

export interface ShopifyNoteAttribute {
  name: string
  value: string
}

export interface ShopifyProperty {
  name: string
  value: string
}

export interface ShopifyLineItem {
  id: number
  title: string
  variant_title?: string | null
  sku?: string | null
  quantity: number
  price: string           // string (Shopify levert decimaal als string)
  total_discount?: string | null
  grams?: number | null   // gewicht in gram
  product_id?: number | null
  variant_id?: number | null
  properties?: ShopifyProperty[]
  fulfillment_status?: string | null
  requires_shipping?: boolean
}

export interface ShopifyOrder {
  id: number
  name: string            // bijv. "#1001"
  order_number: number
  email?: string | null
  phone?: string | null
  note?: string | null
  note_attributes?: ShopifyNoteAttribute[]
  created_at: string
  updated_at: string
  financial_status: string
  fulfillment_status?: string | null
  customer?: ShopifyCustomer | null
  billing_address?: ShopifyAddress | null
  shipping_address?: ShopifyAddress | null
  line_items: ShopifyLineItem[]
  shipping_lines?: Array<{ title?: string; price?: string; code?: string }> | null
  // Shopify B2B velden (aanwezig als B2B-company-order)
  company?: { id: number; name: string; location?: { id: number; name?: string } } | null
}

// Shopify webhook payload voor orders/create
export interface ShopifyOrderWebhook {
  id: number
  name: string
  order_number: number
  email?: string | null
  phone?: string | null
  note?: string | null
  note_attributes?: ShopifyNoteAttribute[]
  created_at: string
  updated_at: string
  financial_status: string
  fulfillment_status?: string | null
  customer?: ShopifyCustomer | null
  billing_address?: ShopifyAddress | null
  shipping_address?: ShopifyAddress | null
  line_items: ShopifyLineItem[]
  shipping_lines?: Array<{ title?: string; price?: string; code?: string }> | null
  company?: { id: number; name: string; location?: { id: number; name?: string } } | null
}

/**
 * Zet een Shopify-adres om naar de veldnamen die `create_webshop_order` verwacht.
 * LET OP: de RPC leest p_header via `->>'sleutel'` en dropt onbekende sleutels
 * geruisloos (zie reference_jsonb_rpc_sleutel_drop) — sleutelnamen hier moeten
 * dus exact matchen met de kolomlijst in de RPC (mig 343): afl_naam, afl_naam_2,
 * afl_adres, afl_postcode, afl_plaats, afl_land, afl_email, afl_telefoon,
 * fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land.
 * Incident 11-06-2026: `afl_stad` werd gedropt → 20 orders zonder afl_plaats
 * → HST pre-flight "plaats is leeg".
 */
export function extractShopifyShippingAddress(order: ShopifyOrderWebhook): Record<string, string | null> {
  const a = order.shipping_address ?? order.billing_address
  if (!a) return {}
  return {
    afl_naam: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.name || a.company || null,
    afl_naam_2: a.company ?? null,
    afl_adres: [a.address1, a.address2].filter(Boolean).join(' ') || null,
    afl_postcode: a.zip ?? null,
    afl_plaats: a.city ?? null,
    afl_land: a.country_code ?? a.country ?? null,
    afl_telefoon: a.phone ?? null,
  }
}

export function extractShopifyBillingAddress(order: ShopifyOrderWebhook): Record<string, string | null> {
  const a = order.billing_address
  if (!a) return {}
  return {
    fact_naam: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.name || a.company || null,
    fact_adres: [a.address1, a.address2].filter(Boolean).join(' ') || null,
    fact_postcode: a.zip ?? null,
    fact_plaats: a.city ?? null,
    fact_land: a.country_code ?? a.country ?? null,
  }
}

/**
 * Map een Shopify line_item naar het LightspeedOrderRow-compatibele formaat
 * zodat `product-matcher.ts` hergebruikt kan worden zonder wijzigingen.
 */
export function shopifyLineItemToMatcherRow(item: ShopifyLineItem) {
  // Dimensies kunnen in `properties` staan als "Lengte", "Breedte", "Maat" etc.
  const findProp = (names: string[]) => {
    for (const prop of item.properties ?? []) {
      if (names.some(n => n.toLowerCase() === prop.name.toLowerCase())) {
        return prop.value
      }
    }
    return null
  }

  const dimensieProp = findProp(['maat', 'size', 'afmeting', 'lengte x breedte'])
  const lengteProp = findProp(['lengte', 'length'])
  const breedteProp = findProp(['breedte', 'width', 'breed'])

  // Shopify "Selections"-producten (configurator-pricing) hebben geen item.sku maar
  // wel een "Maatwerk-sku" property met de echte productcode.
  const maatverkSku = findProp(['maatwerk-sku', 'maatwerk_sku'])
  const effectiveSku = item.sku ?? maatverkSku ?? null

  // Bouw variantTitle op: variant_title als basis, vul aan met dimensies
  let variantTitle = item.variant_title ?? null
  if (!variantTitle && (lengteProp || breedteProp)) {
    variantTitle = `${lengteProp ?? '?'} x ${breedteProp ?? '?'} cm`
  }
  if (!variantTitle && dimensieProp) {
    variantTitle = dimensieProp
  }

  return {
    id: item.id,
    productTitle: item.title,
    variantTitle,
    articleCode: effectiveSku,
    sku: effectiveSku,
    ean: null,
    quantityOrdered: item.quantity,
    priceExcl: parseFloat(item.price ?? '0') || 0,
    priceIncl: parseFloat(item.price ?? '0') || 0,
    discountExcl: parseFloat(item.total_discount ?? '0') || 0,
    // Shopify levert gram; product-matcher gebruikt het voor normalizeGewicht (micro-kg)
    // Wij converteren hier zelf naar kg zodat de caller dat niet hoeft.
    weight: item.grams != null ? item.grams * 1000 : undefined, // gram → milli-gram (≈ micro-kg ×1000/1000)
    customFields: undefined,
    // Extra velden voor de maatwerk-dims-parser
    _shopifyProperties: item.properties ?? [],
  }
}
