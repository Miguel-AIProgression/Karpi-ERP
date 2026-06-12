// Diagnose: kandidaat-orders voor de eerste DESADV-test (verzonden EDI-orders
// van partners met verzend_uit && transus_actief, laatste 14 dagen).
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
function loadEnv(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const t = line.trim(); if (!t || t.startsWith('#')) continue
      const i = t.indexOf('='); if (i < 0) continue
      const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim()
      if (!process.env[k]) process.env[k] = v
    }
  } catch {}
}
loadEnv(resolve(__dirname, '../frontend/.env'))
const URL = process.env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

const cfg = await (await fetch(`${URL}/rest/v1/edi_handelspartner_config?transus_actief=eq.true&verzend_uit=eq.true&select=debiteur_nr,test_modus`, { headers: H })).json()
console.log('verzend_uit-partners:', JSON.stringify(cfg))
const nrs = cfg.map(c => c.debiteur_nr).join(',')

const orders = await (await fetch(
  `${URL}/rest/v1/orders?bron_systeem=eq.edi&status=eq.Verzonden&debiteur_nr=in.(${nrs})` +
  `&select=id,order_nr,debiteur_nr,verzonden_at,afleverdatum,klant_referentie,besteller_gln,factuuradres_gln,afleveradres_gln&order=verzonden_at.desc.nullslast&limit=10`,
  { headers: H })).json()
console.log('\nkandidaten (verzonden, alle):')
// plus: hoeveel EDI-orders per status voor deze partners?
const statussen = await (await fetch(`${URL}/rest/v1/orders?bron_systeem=eq.edi&debiteur_nr=in.(${nrs})&select=status,debiteur_nr`, { headers: H })).json()
const agg = {}
for (const s of statussen) { const k = `${s.debiteur_nr} ${s.status}`; agg[k] = (agg[k] ?? 0) + 1 }
console.log('status-verdeling:', JSON.stringify(agg, null, 1))
for (const o of orders) {
  // bestaand verzendbericht?
  const best = await (await fetch(`${URL}/rest/v1/edi_berichten?richting=eq.uit&berichttype=eq.verzendbericht&bron_tabel=eq.orders&bron_id=eq.${o.id}&select=id,status`, { headers: H })).json()
  console.log(`order ${o.id} ${o.order_nr} deb=${o.debiteur_nr} verzonden=${o.verzonden_at} aflever=${o.afleverdatum} PO=${o.klant_referentie} glns=${o.besteller_gln}/${o.factuuradres_gln}/${o.afleveradres_gln} bestaand_desadv=${JSON.stringify(best)}`)
}
