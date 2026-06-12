// Kies een Hornbach/BDSK EDI-order met de meeste regels als test-render-kandidaat.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
for (const p of ['../frontend/.env']) {
  for (const line of readFileSync(resolve(__dirname, p), 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const i = t.indexOf('='); if (i < 0) continue
    if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
}
const URL = process.env.VITE_SUPABASE_URL
const H = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` }
const orders = await (await fetch(`${URL}/rest/v1/orders?bron_systeem=eq.edi&debiteur_nr=in.(361208,600556)&select=id,order_nr,debiteur_nr,status,afleverdatum,klant_referentie,order_regels(id)&order=id.desc&limit=30`, { headers: H })).json()
for (const o of orders.sort((a, b) => b.order_regels.length - a.order_regels.length).slice(0, 8)) {
  console.log(`order ${o.id} ${o.order_nr} deb=${o.debiteur_nr} status=${o.status} aflever=${o.afleverdatum} PO=${o.klant_referentie} regels=${o.order_regels.length}`)
}
