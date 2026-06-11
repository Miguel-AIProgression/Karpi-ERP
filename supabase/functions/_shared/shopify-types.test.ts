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
  type ShopifyOrderWebhook,
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
