// Gedeelde types en parse-functies voor order-matching en maatwerk-detectie.
//
// Deze module is kanaal-neutraal — zowel Lightspeed, Shopify als toekomstige
// intake-kanalen (e-mail, EDI) leveren hun orderregels in dit formaat aan
// `product-matcher.ts` en `parseMaatwerkDims`.

export interface OrderMatcherCustomFieldValue {
  value?: string | number | boolean
  price?: number | boolean
  percentage?: boolean
}

export interface OrderMatcherCustomField {
  id?: number
  type?: string
  title?: string
  values?: OrderMatcherCustomFieldValue[]
}

/**
 * Kanaal-neutrale orderregel — de gemeenschappelijke invoer voor
 * `product-matcher.ts`, `parseMaatwerkDims` en `collectExtraTexts`.
 *
 * Lightspeed-regels (REST API) passen hier van nature in.
 * Shopify-regels worden door `shopifyLineItemToMatcherRow` naar dit formaat
 * gemapped, waarbij `properties` als `extraTexts` doorkomen.
 */
export interface OrderMatcherRow {
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
  /** Lightspeed customFields — vrije tekst zoals "Afmeting: 120x120 (cm)" */
  customFields?: OrderMatcherCustomField[]
  /**
   * Aanvullende vrije tekst buiten customFields — bv. Shopify line-item
   * `properties` als `"Maatwerk: 260x250 rechthoek"` of `"custom-vorm: organic"`.
   * Door deze door `collectExtraTexts` mee te laten lopen werken
   * `parseMaatwerkDims` en `detectVorm` identiek voor alle orderbronnen.
   */
  extraTexts?: string[]
}

/**
 * Verzamelt alle tekst-values uit customFields én extraTexts van een orderregel.
 * Gebruikt voor maatwerk-afmeting extractie (bijv. "Afmeting: 120x120 (cm)").
 */
export function collectExtraTexts(row: OrderMatcherRow): string[] {
  const texts: string[] = []
  // Lightspeed retourneert soms `customFields: false` (PHP-style) i.p.v. []/null.
  const fields = Array.isArray(row.customFields) ? row.customFields : []
  for (const field of fields) {
    const values = Array.isArray(field.values) ? field.values : []
    for (const v of values) {
      if (v.value != null && typeof v.value === 'string') texts.push(v.value)
    }
  }
  if (Array.isArray(row.extraTexts)) texts.push(...row.extraTexts)
  return texts
}

/**
 * Haal maatwerk-afmeting uit een orderregel. Bekijkt variantTitle,
 * productTitle, articleCode én customFields/extraTexts-tekst. Ondersteunt:
 *   - Rechthoek: "270x140", "285 x 205", "140×200", "Afmeting: 270x140 (cm)"
 *   - Rond (Durchmesser): "Durchmesser 300 cm", "220rnd", "170 rond",
 *                         articleCode-suffix "XX{NNN}RND" (bv. "CISC15XX250RND")
 *
 * Retourneert `{ lengte, breedte, rond }` waarbij bij rond lengte=breedte=diameter.
 * Null als geen afmeting gevonden.
 */
export function parseMaatwerkDims(
  row: OrderMatcherRow,
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
