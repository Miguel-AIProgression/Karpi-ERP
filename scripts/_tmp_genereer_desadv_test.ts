// Genereer een test-DESADV (verzendbericht) voor een echte order, met exact
// dezelfde mapping als bouw-verzendbericht-edi/index.ts — bedoeld voor
// format-validatie in Transus' Testen-tab (geen DB-schrijfacties).
//
// Run: deno run --allow-read --allow-net --allow-write scripts/_tmp_genereer_desadv_test.ts <order_id>
import {
  buildKarpiVerzendbericht,
  type VerzendberichtInput,
} from '../supabase/functions/_shared/transus-formats/karpi-verzendbericht.ts'

const envText = await Deno.readTextFile(new URL('../frontend/.env', import.meta.url))
const env: Record<string, string> = {}
for (const line of envText.split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i < 0) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}
const URL_ = env.VITE_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

const orderId = Number(Deno.args[0])
if (!orderId) {
  console.error('Gebruik: deno run ... _tmp_genereer_desadv_test.ts <order_id>')
  Deno.exit(1)
}

async function get<T>(pad: string): Promise<T> {
  const r = await fetch(`${URL_}/rest/v1/${pad}`, { headers: H })
  if (!r.ok) throw new Error(`${pad}: HTTP ${r.status} ${await r.text()}`)
  return r.json() as Promise<T>
}

// deno-lint-ignore no-explicit-any
const [order] = await get<any[]>(
  `orders?id=eq.${orderId}&select=id,order_nr,orderdatum,afleverdatum,klant_referentie,status,bron_systeem,debiteur_nr,besteller_gln,factuuradres_gln,afleveradres_gln,debiteuren!orders_debiteur_nr_fkey(naam)`,
)
if (!order) throw new Error(`Order ${orderId} niet gevonden`)

// deno-lint-ignore no-explicit-any
const [cfg] = await get<any[]>(
  `edi_handelspartner_config?debiteur_nr=eq.${order.debiteur_nr}&select=transus_actief,verzend_uit,test_modus`,
)

// deno-lint-ignore no-explicit-any
const zRows = await get<any[]>(
  `zending_orders?order_id=eq.${orderId}&select=zendingen(zending_nr,verzenddatum)&limit=1`,
)
const zending = zRows[0]?.zendingen ?? null

// deno-lint-ignore no-explicit-any
const [bedrijfRow] = await get<any[]>(`app_config?sleutel=eq.bedrijfsgegevens&select=waarde`)
const senderGln: string = bedrijfRow?.waarde?.gln_eigen ?? '8715954999998'

// deno-lint-ignore no-explicit-any
const regelRows = await get<any[]>(
  `order_regels?order_id=eq.${orderId}&orderaantal=gt.0&select=id,regelnummer,artikelnr,omschrijving,orderaantal,producten!order_regels_artikelnr_fkey(ean_code,is_pseudo)&order=regelnummer`,
)
const regels = regelRows
  .filter((r) => Number(r.orderaantal) > 0 && !r.producten?.is_pseudo)
  .map((r, idx) => ({
    regelnummer: r.regelnummer ?? idx + 1,
    gtin: r.producten?.ean_code ?? null,
    artikelcode: r.artikelnr ?? null,
    omschrijving: r.omschrijving ?? null,
    aantal: Number(r.orderaantal),
  }))

const input: VerzendberichtInput = {
  zendingNr: zending?.zending_nr ?? order.order_nr,
  verzenddatum: zending?.verzenddatum ?? new Date().toISOString().slice(0, 10),
  leverdatum: order.afleverdatum ?? '',
  orderNumberBuyer: order.klant_referentie ?? '',
  orderNumberSupplier: order.order_nr,
  partnerNaam: order.debiteuren?.naam ?? null,
  senderGln,
  recipientGln: order.factuuradres_gln ?? '',
  buyerGln: order.besteller_gln ?? '',
  deliveryPartyGln: order.afleveradres_gln ?? '',
  isTestMessage: true, // test-render voor de Testen-tab
  regels,
}

console.log('Order:', order.order_nr, '| status:', order.status, '| partner:', order.debiteuren?.naam, '| config:', JSON.stringify(cfg))
console.log('Input:', JSON.stringify(input, null, 2))

const bericht = buildKarpiVerzendbericht(input)
const uitPad = `verzendbericht-test-${order.order_nr}.txt`
await Deno.writeTextFile(uitPad, bericht)
console.log(`\nGeschreven: ${uitPad} (${bericht.length} bytes)`)
