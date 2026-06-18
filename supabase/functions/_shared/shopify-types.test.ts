// Deno unit tests voor shopify-types.ts adres-extractors.
//
// Contract-test tegen de JSONB-RPC-sleutel-drop-bugklasse: create_webshop_order
// (mig 343) leest p_header via ->>'sleutel' en dropt onbekende sleutels
// geruisloos. Incident 11-06-2026: extractor leverde `afl_stad` i.p.v.
// `afl_plaats` → 20 Shopify-orders zonder plaats → HST pre-flight-fout.
// Deze test pint de geproduceerde sleutels vast op de RPC-kolomlijst.

import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import {
  extractShopifyShippingAddress,
  extractShopifyBillingAddress,
  groepeerVoSelectionsItems,
  type ShopifyOrderWebhook,
  type ShopifyLineItem,
} from './shopify-types.ts'

// Sleutels die create_webshop_order (mig 343) daadwerkelijk uit p_header leest.
const RPC_HEADER_SLEUTELS = new Set([
  'fact_naam', 'fact_adres', 'fact_postcode', 'fact_plaats', 'fact_land',
  'afl_naam', 'afl_naam_2', 'afl_adres', 'afl_postcode', 'afl_plaats', 'afl_land',
  'afl_email', 'afl_telefoon',
])

const order = {
  id: 1,
  name: '#1001',
  order_number: 1001,
  created_at: '2026-06-11T08:00:00Z',
  updated_at: '2026-06-11T08:00:00Z',
  financial_status: 'paid',
  line_items: [],
  shipping_address: {
    first_name: 'Jasmijn',
    last_name: 'Clark',
    company: 'MOBA DESIGN',
    address1: 'Raasdorperweg 181G',
    zip: '1175 KV',
    city: 'Lijnden',
    country_code: 'NL',
    phone: '06-12332156',
  },
  billing_address: {
    first_name: 'Moniek',
    last_name: 'Mels',
    address1: 'Dorpsstraat 46',
    zip: '1688 CG',
    city: 'Nibbixwoud',
    country_code: 'NL',
  },
} as unknown as ShopifyOrderWebhook

Deno.test('shipping-extractor levert alleen sleutels die de RPC kent', () => {
  const shipping = extractShopifyShippingAddress(order)
  for (const key of Object.keys(shipping)) {
    assert(RPC_HEADER_SLEUTELS.has(key), `onbekende p_header-sleutel: ${key} (wordt door de RPC gedropt!)`)
  }
})

Deno.test('billing-extractor levert alleen sleutels die de RPC kent', () => {
  const billing = extractShopifyBillingAddress(order)
  for (const key of Object.keys(billing)) {
    assert(RPC_HEADER_SLEUTELS.has(key), `onbekende p_header-sleutel: ${key} (wordt door de RPC gedropt!)`)
  }
})

Deno.test('city landt in afl_plaats / fact_plaats', () => {
  assertEquals(extractShopifyShippingAddress(order).afl_plaats, 'Lijnden')
  assertEquals(extractShopifyBillingAddress(order).fact_plaats, 'Nibbixwoud')
})

Deno.test('company landt in afl_naam_2', () => {
  assertEquals(extractShopifyShippingAddress(order).afl_naam_2, 'MOBA DESIGN')
})

// ===========================================================================
// groepeerVoSelectionsItems — VO Product Options "ouder + Selections"-paar
// (ORD-2026-0623: 2x "Vernon 17 rond" i.p.v. 1x; reconstructie van de echte
// Shopify-payload #5599)
// ===========================================================================
function lineItem(overrides: Partial<ShopifyLineItem>): ShopifyLineItem {
  return {
    id: 1,
    title: '',
    quantity: 1,
    price: '0.00',
    properties: [],
    ...overrides,
  } as ShopifyLineItem
}

Deno.test('groepeerVoSelectionsItems: ouder + Selections-kind worden samengevoegd tot 1 item', () => {
  const ouder = lineItem({
    id: 1, sku: 'VERR17MAATWERK', title: 'Vernon 17 - Shadow Taupe rond',
    variant_title: 'Custom', price: '64.00', properties: [],
  })
  const selections = lineItem({
    id: 2, sku: null, title: 'Vernon 17 - Shadow Taupe rond - Selections',
    variant_title: null, price: '143.36', requires_shipping: false,
    properties: [
      { name: 'Maatwerk', value: '180x180 normal' },
      { name: 'Maatwerk-sku', value: 'VERR17MAATWERK' },
    ],
  })
  const onbetrokken = lineItem({
    id: 3, sku: null, title: 'Vernon 12 - Sandy Dust', variant_title: 'Contour / 240 x 340 cm', price: '525.00',
  })

  const result = groepeerVoSelectionsItems([ouder, selections, onbetrokken])

  assertEquals(result.length, 2, 'het ouder+Selections-paar levert 1 item op, niet 2')
  assertEquals(result[0].title, 'Vernon 17 - Shadow Taupe rond')
  assertEquals(result[0].sku, 'VERR17MAATWERK')
  // De properties van het Selections-kind (de echte maatwerk-info) zitten op het samengevoegde item
  assert(result[0].properties?.some((p) => p.name === 'Maatwerk' && p.value === '180x180 normal'))
  assert(result[0].properties?.some((p) => p.name === 'Maatwerk-sku' && p.value === 'VERR17MAATWERK'))
  // Het niet-gekoppelde derde item blijft ongewijzigd staan
  assertEquals(result[1].title, 'Vernon 12 - Sandy Dust')
})

Deno.test('groepeerVoSelectionsItems: een Selections-item zonder voorafgaande ouder blijft staan (defensief)', () => {
  const wees = lineItem({ id: 9, title: 'Iets - Selections', properties: [{ name: 'X', value: 'Y' }] })
  const result = groepeerVoSelectionsItems([wees])
  assertEquals(result.length, 1)
  assertEquals(result[0], wees)
})

Deno.test('groepeerVoSelectionsItems: normale orders zonder Selections-items blijven ongewijzigd', () => {
  const a = lineItem({ id: 1, title: 'Product A' })
  const b = lineItem({ id: 2, title: 'Product B' })
  assertEquals(groepeerVoSelectionsItems([a, b]), [a, b])
})
