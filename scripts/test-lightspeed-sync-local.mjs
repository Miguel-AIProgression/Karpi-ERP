/**
 * Lokale smoke-test voor de edge function `sync-webshop-order`.
 *
 * Simuleert een Lightspeed webhook door MD5(payload + secret) te berekenen
 * en naar de lokale functions-runtime te POSTen. Bedoeld om de flow te
 * valideren zonder een echte Lightspeed-order nodig te hebben.
 *
 * NB: dit roept wél de echte Lightspeed REST API aan om de order-details
 * op te halen (het script stuurt alleen de webhook-payload, de edge
 * function doet de fetch). Gebruik dus een bestaand order-ID in de shop.
 *
 * Gebruik:
 *   FUNCTION_URL=http://localhost:54321/functions/v1/sync-webshop-order \
 *   SHOP=nl \
 *   ORDER_ID=12345 \
 *     node scripts/test-lightspeed-sync-local.mjs
 */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ENV_PATH = resolve(__dirname, '../supabase/functions/.env')

function loadEnv() {
  try {
    const content = readFileSync(ENV_PATH, 'utf8')
    for (const line of content.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i < 0) continue
      const k = t.slice(0, i).trim()
      const v = t.slice(i + 1).trim()
      if (!process.env[k]) process.env[k] = v
    }
  } catch {
    /* ignore */
  }
}

loadEnv()

const FUNCTION_URL = process.env.FUNCTION_URL ?? 'http://localhost:54321/functions/v1/sync-webshop-order'
const SHOP = process.env.SHOP ?? 'nl'
const ORDER_ID = process.env.ORDER_ID

if (!ORDER_ID) {
  console.error('ORDER_ID is verplicht — geef een echt Lightspeed order-id (deze shop) mee.')
  process.exit(1)
}
if (SHOP !== 'nl' && SHOP !== 'de') {
  console.error(`SHOP moet 'nl' of 'de' zijn, kreeg '${SHOP}'`)
  process.exit(1)
}

const secret = process.env[`LIGHTSPEED_${SHOP.toUpperCase()}_API_SECRET`]
if (!secret) {
  console.error(`LIGHTSPEED_${SHOP.toUpperCase()}_API_SECRET ontbreekt in env`)
  process.exit(1)
}

const payload = JSON.stringify({ order: { id: Number(ORDER_ID) } })
const signature = createHash('md5').update(payload + secret).digest('hex')
const url = `${FUNCTION_URL}?shop=${SHOP}`

console.log(`POST ${url}`)
console.log(`payload: ${payload}`)
console.log(`x-signature: ${signature}`)

async function run() {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-signature': signature },
    body: payload,
  })
  const text = await res.text()
  console.log(`\n<-- ${res.status} ${res.statusText}`)
  console.log(text)

  if (res.ok) {
    console.log('\n--- Idempotentie-check: tweede POST ---')
    const res2 = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-signature': signature },
      body: payload,
    })
    const text2 = await res2.text()
    console.log(`<-- ${res2.status} ${res2.statusText}`)
    console.log(text2)
    const parsed = JSON.parse(text2)
    if (parsed.was_existing !== true) {
      console.error('FAIL: tweede POST had was_existing=true moeten zijn')
      process.exit(1)
    }
    console.log('OK: idempotent.')
  }
}

await run()
