/**
 * Registreert Shopify webhooks voor de B2B-shop.
 *
 * Idempotent: haalt eerst bestaande webhooks op en slaat registratie over
 * als het endpoint al geregistreerd staat. Draai dit 1x na het deployen
 * van de `sync-shopify-order` edge function.
 *
 * Gebruik:
 *   SHOPIFY_SHOP_DOMAIN=jouw-shop.myshopify.com \
 *   SHOPIFY_ACCESS_TOKEN=shpat_xxxx \
 *   EDGE_FUNCTION_URL=https://<project>.supabase.co/functions/v1/sync-shopify-order \
 *     node scripts/register-shopify-webhooks.mjs
 *
 *   # Dry-run (toont wat er geregistreerd zou worden):
 *   DRY_RUN=1 ... node scripts/register-shopify-webhooks.mjs
 *
 *   # Verwijder alle webhooks die naar onze edge function verwijzen:
 *   CLEANUP=1 ... node scripts/register-shopify-webhooks.mjs
 *
 * Vereiste env vars (of in supabase/functions/.env):
 *   SHOPIFY_SHOP_DOMAIN    — bijv. "karpi-b2b.myshopify.com"
 *   SHOPIFY_ACCESS_TOKEN   — Admin API access token (shpat_...)
 *   EDGE_FUNCTION_URL      — Supabase edge function URL
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ENV_PATH = resolve(__dirname, '../supabase/functions/.env')

function loadEnv() {
  try {
    const content = readFileSync(ENV_PATH, 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx < 0) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const value = trimmed.slice(eqIdx + 1).trim()
      if (!process.env[key]) process.env[key] = value
    }
  } catch {
    // .env optioneel — env vars kunnen ook direct meegegeven worden
  }
}

loadEnv()

const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN
const EDGE_FUNCTION_URL = process.env.EDGE_FUNCTION_URL
const DRY_RUN = process.env.DRY_RUN === '1'
const CLEANUP = process.env.CLEANUP === '1'
const API_VERSION = '2024-01'

if (!SHOP_DOMAIN || !ACCESS_TOKEN || !EDGE_FUNCTION_URL) {
  console.error('Verplichte env vars: SHOPIFY_SHOP_DOMAIN, SHOPIFY_ACCESS_TOKEN, EDGE_FUNCTION_URL')
  process.exit(1)
}

const BASE_URL = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}`
const HEADERS = {
  'X-Shopify-Access-Token': ACCESS_TOKEN,
  'Content-Type': 'application/json',
}

const WEBHOOK_TARGET = EDGE_FUNCTION_URL.replace(/\/$/, '')

// Welke Shopify-events we willen ontvangen
const TOPICS_TO_REGISTER = [
  'orders/create',
]

async function listWebhooks() {
  const res = await fetch(`${BASE_URL}/webhooks.json?limit=250`, { headers: HEADERS })
  if (!res.ok) throw new Error(`list webhooks: ${res.status} ${await res.text()}`)
  const body = await res.json()
  return body.webhooks ?? []
}

async function createWebhook(topic, address) {
  const res = await fetch(`${BASE_URL}/webhooks.json`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      webhook: {
        topic,
        address,
        format: 'json',
      },
    }),
  })
  if (!res.ok) throw new Error(`create webhook (${topic}): ${res.status} ${await res.text()}`)
  const body = await res.json()
  return body.webhook
}

async function deleteWebhook(id) {
  const res = await fetch(`${BASE_URL}/webhooks/${id}.json`, {
    method: 'DELETE',
    headers: HEADERS,
  })
  if (!res.ok) throw new Error(`delete webhook ${id}: ${res.status} ${await res.text()}`)
}

async function main() {
  console.log(`Shop: ${SHOP_DOMAIN}`)
  console.log(`Edge function: ${WEBHOOK_TARGET}`)
  if (DRY_RUN) console.log('DRY_RUN=1 — niets wordt daadwerkelijk geregistreerd')

  const existing = await listWebhooks()
  console.log(`Bestaande webhooks: ${existing.length}`)

  if (CLEANUP) {
    const onze = existing.filter(w => w.address?.startsWith(WEBHOOK_TARGET))
    console.log(`Te verwijderen: ${onze.length} webhook(s) die naar ${WEBHOOK_TARGET} verwijzen`)
    for (const wh of onze) {
      if (DRY_RUN) {
        console.log(`  DRY_RUN — zou verwijderen: id=${wh.id} topic=${wh.topic}`)
      } else {
        await deleteWebhook(wh.id)
        console.log(`  Verwijderd: id=${wh.id} topic=${wh.topic}`)
      }
    }
    return
  }

  for (const topic of TOPICS_TO_REGISTER) {
    const match = existing.find(w => w.topic === topic && w.address === WEBHOOK_TARGET)

    if (match) {
      console.log(`[${topic}] al geregistreerd (id=${match.id}) → skip`)
      continue
    }

    if (DRY_RUN) {
      console.log(`[${topic}] DRY_RUN — zou registreren naar: ${WEBHOOK_TARGET}`)
      continue
    }

    const created = await createWebhook(topic, WEBHOOK_TARGET)
    console.log(`[${topic}] geregistreerd: id=${created.id}`)
    console.log(`  Let op: sla de webhook secret op als SHOPIFY_WEBHOOK_SECRET in Supabase Edge Functions secrets.`)
    console.log(`  Je vindt de signing secret in Shopify: Instellingen → Meldingen → Webhooks → [webhook] → Signing secret`)
  }

  // Toon bestaande webhooks die naar onze endpoint verwijzen
  const onzeBestaande = existing.filter(w => w.address?.startsWith(WEBHOOK_TARGET))
  if (onzeBestaande.length > 0) {
    console.log('\nActieve webhooks naar onze edge function:')
    for (const wh of onzeBestaande) {
      console.log(`  id=${wh.id} topic=${wh.topic} address=${wh.address}`)
    }
  }
}

await main()
