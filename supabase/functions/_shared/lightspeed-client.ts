// Lightspeed eCom REST-client voor edge functions.
//
// Auth: HTTP Basic met API key + secret per shop. EU1-cluster.
// Zie plan 2026-04-17-lightspeed-webshop-orders.md.

export type LightspeedShop = 'nl' | 'de'

export interface LightspeedOrderAddress {
  Name?: string
  Street?: string
  Number?: string
  Extension?: string
  Zipcode?: string
  City?: string
  Region?: string
  Country?: { id: number; code: string; title: string }
}

export interface LightspeedOrderRow {
  id: number
  productTitle: string
  variantTitle: string | null
  articleCode: string | null
  sku: string | null
  ean: string | null
  quantityOrdered: number
  priceExcl: number
  priceIncl: number
  discountExcl?: number
  discountIncl?: number
  weight?: number
}

export interface LightspeedOrder {
  id: number
  number: number
  status: string
  paymentStatus: string
  shipmentStatus: string | null
  createdAt: string
  priceExcl: number
  priceIncl: number
  weight?: number
  email?: string
  firstname?: string
  lastname?: string
  phone?: string
  customerNote?: string
  // Shipping address
  addressShippingName?: string
  addressShippingStreet?: string
  addressShippingNumber?: string
  addressShippingExtension?: string
  addressShippingZipcode?: string
  addressShippingCity?: string
  addressShippingRegion?: string
  addressShippingCountry?: { id: number; code: string; title: string } | string
  // Billing address
  addressBillingName?: string
  addressBillingStreet?: string
  addressBillingNumber?: string
  addressBillingExtension?: string
  addressBillingZipcode?: string
  addressBillingCity?: string
  addressBillingRegion?: string
  addressBillingCountry?: { id: number; code: string; title: string } | string
  // Embedded products
  products?: Array<LightspeedOrderRow>
}

export interface LightspeedClient {
  shop: LightspeedShop
  getOrder: (id: number | string) => Promise<LightspeedOrder>
  getOrderProducts: (orderId: number | string) => Promise<LightspeedOrderRow[]>
}

function envOrThrow(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

export function createClient(shop: LightspeedShop): LightspeedClient {
  const suffix = shop.toUpperCase()
  const key = envOrThrow(`LIGHTSPEED_${suffix}_API_KEY`)
  const secret = envOrThrow(`LIGHTSPEED_${suffix}_API_SECRET`)
  const baseRaw = envOrThrow(`LIGHTSPEED_${suffix}_CLUSTER_URL`)
  const base = baseRaw.endsWith('/') ? baseRaw.slice(0, -1) : baseRaw
  const auth = 'Basic ' + btoa(`${key}:${secret}`)

  async function request<T>(path: string): Promise<T> {
    const url = `${base}${path}`
    let lastErr: unknown
    // 1 retry op 5xx, exponential: 200ms → 800ms
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { Authorization: auth, Accept: 'application/json' },
        })
        if (res.status >= 500) {
          lastErr = new Error(`Lightspeed ${res.status} ${res.statusText} @ ${path}`)
          await new Promise((r) => setTimeout(r, 200 * Math.pow(4, attempt)))
          continue
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '<no body>')
          throw new Error(`Lightspeed ${res.status} @ ${path}: ${body}`)
        }
        return (await res.json()) as T
      } catch (err) {
        lastErr = err
        if (attempt === 1) break
        await new Promise((r) => setTimeout(r, 200 * Math.pow(4, attempt)))
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  }

  return {
    shop,
    async getOrder(id) {
      const resp = await request<{ order: LightspeedOrder }>(`/orders/${id}.json`)
      return resp.order
    },
    async getOrderProducts(id) {
      const resp = await request<{ orderProducts: LightspeedOrderRow[] }>(
        `/orders/${id}/products.json`,
      )
      return resp.orderProducts ?? []
    },
  }
}

// Haal orderadres-snapshot op in RugFlow-formaat.
export function extractShippingAddress(order: LightspeedOrder): {
  afl_naam: string | null
  afl_naam_2: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_plaats: string | null
  afl_land: string | null
} {
  const land = typeof order.addressShippingCountry === 'object'
    ? order.addressShippingCountry?.code ?? null
    : order.addressShippingCountry ?? null
  const straat = [order.addressShippingStreet, order.addressShippingNumber, order.addressShippingExtension]
    .filter(Boolean)
    .join(' ')
    .trim() || null
  return {
    afl_naam: order.addressShippingName ?? null,
    afl_naam_2: null,
    afl_adres: straat,
    afl_postcode: order.addressShippingZipcode ?? null,
    afl_plaats: order.addressShippingCity ?? null,
    afl_land: land,
  }
}

export function extractBillingAddress(order: LightspeedOrder): {
  fact_naam: string | null
  fact_adres: string | null
  fact_postcode: string | null
  fact_plaats: string | null
  fact_land: string | null
} {
  const land = typeof order.addressBillingCountry === 'object'
    ? order.addressBillingCountry?.code ?? null
    : order.addressBillingCountry ?? null
  const straat = [order.addressBillingStreet, order.addressBillingNumber, order.addressBillingExtension]
    .filter(Boolean)
    .join(' ')
    .trim() || null
  return {
    fact_naam: order.addressBillingName ?? null,
    fact_adres: straat,
    fact_postcode: order.addressBillingZipcode ?? null,
    fact_plaats: order.addressBillingCity ?? null,
    fact_land: land,
  }
}
