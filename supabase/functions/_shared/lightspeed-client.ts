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

export interface LightspeedCustomFieldValue {
  value?: string | number | boolean
  price?: number | boolean
  percentage?: boolean
}

export interface LightspeedCustomField {
  id?: number
  type?: string
  title?: string
  values?: LightspeedCustomFieldValue[]
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
  customFields?: LightspeedCustomField[]
}

export interface LightspeedOrder {
  id: number
  number: number
  status: string
  paymentStatus: string
  shipmentStatus: string | null
  shipmentTitle?: string | null
  deliveryDate?: string | null
  shippingDate?: string | null
  createdAt: string
  priceExcl: number
  priceIncl: number
  weight?: number
  email?: string
  firstname?: string
  lastname?: string
  phone?: string
  customerNote?: string
  addressShippingName?: string
  addressShippingStreet?: string
  addressShippingNumber?: string
  addressShippingExtension?: string
  addressShippingZipcode?: string
  addressShippingCity?: string
  addressShippingRegion?: string
  addressShippingCountry?: { id: number; code: string; title: string } | string
  addressBillingName?: string
  addressBillingStreet?: string
  addressBillingNumber?: string
  addressBillingExtension?: string
  addressBillingZipcode?: string
  addressBillingCity?: string
  addressBillingRegion?: string
  addressBillingCountry?: { id: number; code: string; title: string } | string
  products?: Array<LightspeedOrderRow>
}

export interface LightspeedListOrdersParams {
  status?: string
  paymentStatus?: string
  createdAtMin?: string
  limit?: number
  page?: number
}

export interface LightspeedClient {
  shop: LightspeedShop
  getOrder: (id: number | string) => Promise<LightspeedOrder>
  getOrderProducts: (orderId: number | string) => Promise<LightspeedOrderRow[]>
  listOrders: (params: LightspeedListOrdersParams) => Promise<{ count: number; orders: LightspeedOrder[] }>
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
      const products = resp.orderProducts ?? []
      if (products.length > 0) {
        console.log('[lightspeed] customFields:', JSON.stringify(products[0].customFields ?? null))
      }
      return products
    },
    async listOrders(params) {
      const qs = new URLSearchParams()
      if (params.status) qs.set('status[]', params.status)
      if (params.paymentStatus) qs.set('paymentStatus[]', params.paymentStatus)
      if (params.createdAtMin) qs.set('createdAt[min]', params.createdAtMin)
      qs.set('limit', String(params.limit ?? 250))
      qs.set('page', String(params.page ?? 1))
      qs.set('sort', 'createdAt ASC')
      const resp = await request<{ count: number; orders: LightspeedOrder[] }>(
        `/orders.json?${qs.toString()}`,
      )
      return { count: resp.count ?? 0, orders: resp.orders ?? [] }
    },
  }
}

/**
 * Verzamelt alle tekst-values uit customFields van een orderregel.
 * Gebruikt voor maatwerk-afmeting extractie (bijv. "Afmeting: 120x120 (cm)").
 */
export function collectExtraTexts(row: LightspeedOrderRow): string[] {
  const texts: string[] = []
  // Lightspeed retourneert soms `customFields: false` (PHP-style) i.p.v. []/null.
  // `?? []` dekt die niet — Array.isArray garandeert iterable.
  const fields = Array.isArray(row.customFields) ? row.customFields : []
  for (const field of fields) {
    const values = Array.isArray(field.values) ? field.values : []
    for (const v of values) {
      if (v.value != null && typeof v.value === 'string') texts.push(v.value)
    }
  }
  return texts
}

/**
 * Haal maatwerk-afmeting uit een Lightspeed-orderregel. Bekijkt variantTitle,
 * productTitle, articleCode én customFields-tekst. Ondersteunt:
 *   - Rechthoek: "270x140", "285 x 205", "140×200", "Afmeting: 270x140 (cm)"
 *   - Rond (Durchmesser): "Durchmesser 300 cm", "220rnd", "170 rond",
 *                         articleCode-suffix "XX{NNN}RND" (bv. "CISC15XX250RND")
 *
 * Retourneert `{ lengte, breedte, rond }` waarbij bij rond lengte=breedte=diameter.
 * Null als geen afmeting gevonden.
 */
export function parseMaatwerkDims(
  row: LightspeedOrderRow,
): { lengte: number; breedte: number; rond: boolean } | null {
  const hay = [row.variantTitle, row.productTitle, row.articleCode, ...collectExtraTexts(row)]
    .filter(Boolean)
    .join(' ')

  // 1) Rechthoek — LxB of BxL
  const rect = hay.match(/(\d{2,3})\s*[xX×]\s*(\d{2,3})(?!\s*RND)/)
  if (rect) {
    const l = Number(rect[1]); const b = Number(rect[2])
    if (l >= 20 && b >= 20 && l <= 900 && b <= 900) {
      return { lengte: l, breedte: b, rond: false }
    }
  }

  // 2) Rond — diverse notaties
  //    "Durchmesser 300 cm" / "Durchmesser: 250"
  const durch = hay.match(/durchmesser[\s:]*(\d{2,3})/i)
  if (durch) {
    const d = Number(durch[1])
    if (d >= 40 && d <= 900) return { lengte: d, breedte: d, rond: true }
  }
  //    "220rnd" / "170 rond" / "250 rund"
  const rnd = hay.match(/(\d{2,3})\s*(?:rnd|rond|rund)\b/i)
  if (rnd) {
    const d = Number(rnd[1])
    if (d >= 40 && d <= 900) return { lengte: d, breedte: d, rond: true }
  }
  //    articleCode-suffix "XX250RND"
  const codeRnd = (row.articleCode ?? '').match(/XX(\d{2,3})RND/i)
  if (codeRnd) {
    const d = Number(codeRnd[1])
    if (d >= 40 && d <= 900) return { lengte: d, breedte: d, rond: true }
  }

  return null
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
