#!/usr/bin/env node
// Eenmalig: upload het KARPI GROUP-logo naar de public-assets storage-bucket.
// Wordt door de factuur-pdf edge function gedownload bij elke render.
//
// Gebruik: node scripts/upload-karpi-logo.mjs
//
// Leest SUPABASE_URL + SERVICE_ROLE_KEY uit frontend/.env. Bucket en pad worden
// gelezen uit app_config.bedrijfsgegevens.{logo_storage_bucket,logo_storage_pad}
// — vul mig 221 eerst toe als die kolommen nog niet bestaan.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = readFileSync(resolve(__dirname, '..', 'frontend', '.env'), 'utf8')
const SUPABASE_URL = env.match(/VITE_SUPABASE_URL=(.+)/)[1].trim()
const SERVICE_KEY = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()

const LOGO_PATH = resolve(__dirname, '..', 'brondata', 'logos', 'karpi nieuwe logo.jpg')

async function getBedrijfsgegevens() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/app_config?sleutel=eq.bedrijfsgegevens&select=waarde`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  )
  if (!res.ok) throw new Error(`Bedrijfsgegevens fetch: ${res.status} ${await res.text()}`)
  const rows = await res.json()
  return rows[0]?.waarde ?? {}
}

async function ensureBucket(id) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ id, name: id, public: true }),
  })
  if (res.ok) {
    console.log(`Bucket "${id}" aangemaakt.`)
    return
  }
  // Storage REST geeft 400 + body { statusCode: "409", error: "Duplicate" } als de bucket bestaat
  const body = await res.text()
  if (res.status === 409 || body.includes('"409"') || body.includes('Duplicate')) {
    console.log(`Bucket "${id}" bestaat al — ok.`)
    return
  }
  throw new Error(`Bucket-create: ${res.status} ${body}`)
}

async function uploadLogo(bucket, pad) {
  const bytes = readFileSync(LOGO_PATH)
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${pad}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'image/jpeg',
      'x-upsert': 'true',
    },
    body: bytes,
  })
  if (!res.ok) throw new Error(`Upload: ${res.status} ${await res.text()}`)
  console.log(`Logo geüpload naar ${bucket}/${pad} (${bytes.length} bytes)`)
}

;(async () => {
  const bedrijf = await getBedrijfsgegevens()
  const bucket = bedrijf.logo_storage_bucket ?? 'public-assets'
  const pad = bedrijf.logo_storage_pad ?? 'karpi-logo.jpg'
  console.log(`Doel: ${bucket}/${pad}`)
  await ensureBucket(bucket)
  await uploadLogo(bucket, pad)
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
