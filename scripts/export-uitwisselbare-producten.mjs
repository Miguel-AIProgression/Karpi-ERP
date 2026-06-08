/**
 * Exporteert de "Uitwisselbaar"-groepen (Producten-pagina) naar een CSV-bestand
 * dat direct in Excel geopend kan worden — landt lokaal in de projectmap i.p.v.
 * via een browser-download.
 *
 * Gebruik:
 *   node scripts/export-uitwisselbare-producten.mjs [--out=/pad/naar/map]
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-geladen uit .env)
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

for (const f of ['supabase/functions/.env', 'frontend/.env']) {
  const p = resolve(f)
  if (!existsSync(p)) continue
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    const key = m[1].startsWith('VITE_') ? m[1].slice(5) : m[1]
    if (!process.env[key]) process.env[key] = m[2]
    if (!process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
const outArg = process.argv.find((a) => a.startsWith('--out='))
const OUT_DIR = outArg ? resolve(outArg.slice('--out='.length)) : resolve('.')

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY verplicht')
  process.exit(1)
}

const H = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` }

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { headers: H })
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

function csvCell(value) {
  const s = String(value ?? '')
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function main() {
  const [collecties, kwaliteiten] = await Promise.all([
    sbGet('/rest/v1/collecties?actief=eq.true&select=id,naam&order=naam'),
    sbGet('/rest/v1/kwaliteiten?collectie_id=not.is.null&select=code,omschrijving,collectie_id&order=code'),
  ])

  const linkedCodes = kwaliteiten.map((k) => k.code)
  if (linkedCodes.length === 0) {
    console.log('Geen gekoppelde kwaliteiten gevonden.')
    return
  }

  const producten = []
  const PAGE_SIZE = 1000
  let offset = 0
  while (true) {
    const batch = await sbGet(
      `/rest/v1/producten?kwaliteit_code=in.(${linkedCodes.join(',')})&actief=eq.true&kleur_code=not.is.null&select=kwaliteit_code,kleur_code&offset=${offset}&limit=${PAGE_SIZE}`,
    )
    if (batch.length === 0) break
    producten.push(...batch)
    if (batch.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  const kleurenPerKwaliteit = new Map()
  for (const p of producten) {
    if (!kleurenPerKwaliteit.has(p.kwaliteit_code)) kleurenPerKwaliteit.set(p.kwaliteit_code, new Set())
    kleurenPerKwaliteit.get(p.kwaliteit_code).add(p.kleur_code)
  }

  const kwalPerCollectie = new Map()
  for (const k of kwaliteiten) {
    if (!kwalPerCollectie.has(k.collectie_id)) kwalPerCollectie.set(k.collectie_id, [])
    kwalPerCollectie.get(k.collectie_id).push({ code: k.code, omschrijving: k.omschrijving })
  }

  const rows = []
  for (const c of collecties) {
    const kwals = kwalPerCollectie.get(c.id)
    if (!kwals || kwals.length < 2) continue

    const kwaliteitKleuren = kwals.map((k) => ({
      ...k,
      kleuren: Array.from(kleurenPerKwaliteit.get(k.code) ?? []).sort(),
    }))

    const allKleurSets = kwaliteitKleuren.map((k) => new Set(k.kleuren))
    const allKleuren = new Set(kwaliteitKleuren.flatMap((k) => k.kleuren))
    const gedeeld = new Set()
    for (const kleur of allKleuren) {
      if (allKleurSets.filter((s) => s.has(kleur)).length >= 2) gedeeld.add(kleur)
    }

    for (const kwal of kwaliteitKleuren) {
      const kleuren = kwal.kleuren.length > 0 ? kwal.kleuren : [null]
      for (const kleur of kleuren) {
        rows.push({
          'Groep': c.naam,
          'Kwaliteit code': kwal.code,
          'Kwaliteit omschrijving': kwal.omschrijving ?? '',
          'Kleur': kleur ?? '',
          'Uitwisselbaar met andere kwaliteit in groep': kleur && gedeeld.has(kleur) ? 'Ja' : 'Nee',
        })
      }
    }
  }

  if (rows.length === 0) {
    console.log('Geen uitwisselbare groepen gevonden.')
    return
  }

  const headers = Object.keys(rows[0])
  const lines = [
    headers.map(csvCell).join(';'),
    ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(';')),
  ]

  const datum = new Date().toISOString().slice(0, 10)
  const filename = `uitwisselbare-producten_${datum}.csv`
  const fullPath = resolve(OUT_DIR, filename)
  writeFileSync(fullPath, '﻿' + lines.join('\n'), 'utf8')

  console.log(`Geschreven: ${fullPath}  (${rows.length} regels)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
