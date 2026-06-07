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

/** Zet een Shopify-adres om naar de veldnamen die `create_webshop_order` verwacht. */
export function extractShopifyShippingAddress(order: ShopifyOrderWebhook): Record<string, string | null> {
  const a = order.shipping_address ?? order.billing_address
  if (!a) return {}
  return {
    afl_naam: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.name || a.company || null,
    afl_bedrijf: a.company ?? null,
    afl_adres: [a.address1, a.address2].filter(Boolean).join(' ') || null,
    afl_postcode: a.zip ?? null,
    afl_stad: a.city ?? null,
    afl_land: a.country_code ?? a.country ?? null,
    afl_telefoon: a.phone ?? null,
  }
}

export function extractShopifyBillingAddress(order: ShopifyOrderWebhook): Record<string, string | null> {
  const a = order.billing_address
  if (!a) return {}
  return {
    fact_naam: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.name || a.company || null,
    fact_bedrijf: a.company ?? null,
    fact_adres: [a.address1, a.address2].filter(Boolean).join(' ') || null,
    fact_postcode: a.zip ?? null,
    fact_stad: a.city ?? null,
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

  // Shopify's maatwerk-app laat `sku` soms leeg en levert de Karpi-productcode
  // dan via een line-item property "Maatwerk-sku" (bv. "LAGO13XXMAATWERK").
  // Die code is autoritatief (zie matchProduct's articleCode-override) — zonder
  // deze fallback blijft hij onbenut en valt de matcher terug op fuzzy naam-matching.
  const maatwerkSkuProp = findProp(['maatwerk-sku', 'maatwerk sku'])
  const sku = item.sku?.trim() || maatwerkSkuProp || null

  // Bouw variantTitle op: variant_title als basis, vul aan met dimensies
  let variantTitle = item.variant_title ?? null
  if (!variantTitle && (lengteProp || breedteProp)) {
    variantTitle = `${lengteProp ?? '?'} x ${breedteProp ?? '?'} cm`
  }
  if (!variantTitle && dimensieProp) {
    variantTitle = dimensieProp
  }

  // Shopify's maatwerk-app levert de échte specificaties vaak als losse
  // line-item `properties` i.p.v. in variant_title — bijv. een property
  // genaamd "Maatwerk" met waarde "260x250 rechthoek", of "custom-vorm"
  // met waarde "organic". `"naam: waarde"` zodat parseMaatwerkDims/detectVorm
  // (via collectExtraTexts → extraTexts) zowel de sleutel als de inhoud zien
  // — exact dezelfde parser als voor mail-orders, geen aparte Shopify-logica.
  const extraTexts = (item.properties ?? [])
    .filter(p => p.name && p.value)
    .map(p => `${p.name}: ${p.value}`)

  return {
    id: item.id,
    productTitle: item.title,
    variantTitle,
    articleCode: sku,
    sku,
    ean: null,
    quantityOrdered: item.quantity,
    priceExcl: parseFloat(item.price ?? '0') || 0,
    priceIncl: parseFloat(item.price ?? '0') || 0,
    discountExcl: parseFloat(item.total_discount ?? '0') || 0,
    // Shopify levert gram; product-matcher gebruikt het voor normalizeGewicht (micro-kg)
    // Wij converteren hier zelf naar kg zodat de caller dat niet hoeft.
    weight: item.grams != null ? item.grams * 1000 : undefined, // gram → milli-gram (≈ micro-kg ×1000/1000)
    customFields: undefined,
    extraTexts,
  }
}
