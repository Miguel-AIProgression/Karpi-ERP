/**
 * Registreert Lightspeed eCom webhooks voor Floorpassion NL + DE.
 *
 * Idempotent: haalt eerst bestaande webhooks op en slaat registratie over
 * als het endpoint al geregistreerd staat. Draai dit 1x na het deployen
 * van de `sync-webshop-order` edge function.
 *
 * Gebruik:
 *   # Vanuit supabase/functions/.env + EDGE_FUNCTION_URL
 *   EDGE_FUNCTION_URL=https://<project>.supabase.co/functions/v1/sync-webshop-order \
 *     node scripts/register-lightspeed-webhooks.mjs
 *
 *   # Of dry-run (toont wat er geregistreerd zou worden):
 *   DRY_RUN=1 EDGE_FUNCTION_URL=... node scripts/register-lightspeed-webhooks.mjs
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
  } catch (err) {
    console.warn(`Kon ${ENV_PATH} niet lezen:`, err.message)
  }
}

loadEnv()

const EDGE_FUNCTION_URL = process.env.EDGE_FUNCTION_URL
const DRY_RUN = process.env.DRY_RUN === '1'

if (!EDGE_FUNCTION_URL) {
  console.error('EDGE_FUNCTION_URL is verplicht (inclusief /sync-webshop-order pad)')
  process.exit(1)
}

const SHOPS = [
  { code: 'nl', language: 'nl' },
  { code: 'de', language: 'de' },
]

async function listWebhooks(base, auth) {
  const res = await fetch(`${base}/webhooks.json`, { headers: { Authorization: auth } })
  if (!res.ok) throw new Error(`list webhooks: ${res.status} ${await res.text()}`)
  const body = await res.json()
  return body.webhooks ?? []
}

async function createWebhook(base, auth, payload) {
  const res = await fetch(`${base}/webhooks.json`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhook: payload }),
  })
  if (!res.ok) throw new Error(`create webhook: ${res.status} ${await res.text()}`)
  return res.json()
}

async function registerShop({ code, language }) {
  const suffix = code.toUpperCase()
  const key = process.env[`LIGHTSPEED_${suffix}_API_KEY`]
  const secret = process.env[`LIGHTSPEED_${suffix}_API_SECRET`]
  const clusterRaw = process.env[`LIGHTSPEED_${suffix}_CLUSTER_URL`]

  if (!key || !secret || !clusterRaw) {
    console.warn(`[${code}] skip — ontbrekende env vars`)
    return
  }

  const base = clusterRaw.replace(/\/$/, '')
  const auth = 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64')
  const targetAddress = `${EDGE_FUNCTION_URL.replace(/\/$/, '')}?shop=${code}`

  const existing = await listWebhooks(base, auth)
  const match = existing.find(
    (w) =>
      w.itemGroup === 'orders' &&
      w.itemAction === 'paid' &&
      w.address === targetAddress,
  )

  if (match) {
    console.log(`[${code}] webhook al geregistreerd (id=${match.id}) → skip`)
    return
  }

  const payload = {
    isActive: true,
    itemGroup: 'orders',
    itemAction: 'paid',
    language,
    format: 'json',
    address: targetAddress,
  }

  if (DRY_RUN) {
    console.log(`[${code}] DRY_RUN — zou registreren:`, payload)
    return
  }

  const created = await createWebhook(base, auth, payload)
  console.log(`[${code}] geregistreerd:`, created.webhook?.id ?? created)
}

async function main() {
  for (const shop of SHOPS) {
    try {
      await registerShop(shop)
    } catch (err) {
      console.error(`[${shop.code}] FOUT:`, err.message)
    }
  }
}

await main()
