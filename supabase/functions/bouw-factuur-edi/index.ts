// Supabase Edge Function: bouw-factuur-edi
//
// Zet een (per-order) factuur op de uitgaande EDI-wachtrij. Bouwt het INVOIC via
// de GEDEELDE Factuurdocument-renderer (ADR-0036) — exact hetzelfde pad als het
// automatische factuur-verzenden, zodat handmatig en automatisch byte-identiek
// INVOIC produceren. Idempotente insert in `edi_berichten`
// (richting='uit', berichttype='factuur'). De cron `transus-send` verstuurt 'm.
//
// Scope V1: alleen facturen die precies 1 order dekken (per_zending).
// Plan: docs/superpowers/plans/2026-06-14-factuurdocument-deep-module.md

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildKarpiInvoiceFixedWidth } from '../_shared/transus-formats/karpi-invoice-fixed-width.ts'
import { fetchFactuurDocument } from '../_shared/facturatie/factuur-document.ts'
import {
  naarInvoiceInput,
  type FactuurInvoiceContext,
  type FactuurInvoiceOrder,
} from '../_shared/facturatie/factuur-invoice-renderer.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const ORDER_VELDEN =
  'id, order_nr, oud_order_nr, orderdatum, klant_referentie, ' +
  'bes_naam, bes_adres, bes_postcode, bes_plaats, bes_land, besteller_gln, ' +
  'afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land, ' +
  'factuuradres_gln, afleveradres_gln'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  try {
    let factuurId = 0
    try {
      const body = await req.json()
      factuurId = Number(body?.factuur_id ?? 0)
    } catch {
      // geen body
    }
    if (!Number.isFinite(factuurId) || factuurId <= 0) {
      return json(400, { error: 'factuur_id ontbreekt of is ongeldig' })
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)

    // Bedrijfsgegevens alvast.
    const bedrijfRes = await sb
      .from('app_config')
      .select('waarde')
      .eq('sleutel', 'bedrijfsgegevens')
      .maybeSingle()
    if (bedrijfRes.error) return json(500, { error: `Fetch bedrijfsgegevens: ${bedrijfRes.error.message}` })
    if (!bedrijfRes.data?.waarde) return json(500, { error: 'Bedrijfsgegevens ontbreken (app_config)' })
    const bedrijf = bedrijfRes.data.waarde as BedrijfConfig

    // Canoniek Factuurdocument (header + regels mét Artikelpresentatie).
    let doc
    try {
      doc = await fetchFactuurDocument(sb, factuurId)
    } catch (e) {
      return json(404, { error: e instanceof Error ? e.message : String(e) })
    }
    if (doc.regels.length === 0) return json(422, { error: `Factuur ${doc.header.factuur_nr} heeft geen regels` })

    // Multi-order toegestaan: een verzamelfactuur (bundel mig 222 / wekelijks)
    // dekt meerdere orders. De renderer mapt per regel de juiste order
    // (orderNumberBuyer) via ordersById; ctx.orders[0] levert de partij-GLN's
    // (zelfde adres binnen een bundel). Spiegelt het auto-pad factuur-verzenden.
    const orderIds = Array.from(new Set(doc.regels.map((r) => r.order_id).filter((v) => Number.isFinite(v))))
    if (orderIds.length === 0) {
      return json(422, { error: `Factuur ${doc.header.factuur_nr} heeft geen gekoppelde orders` })
    }
    const orderId = orderIds[0]

    const [orderRes, debiteurRes, configRes] = await Promise.all([
      sb.from('orders').select(ORDER_VELDEN).in('id', orderIds),
      sb
        .from('debiteuren')
        .select(
          'naam, btw_nummer, fact_naam, fact_adres, fact_postcode, fact_plaats, adres, postcode, plaats, land, gln_bedrijf',
        )
        .eq('debiteur_nr', doc.header.debiteur_nr)
        .maybeSingle(),
      sb
        .from('edi_handelspartner_config')
        .select('factuur_uit, transus_actief, test_modus')
        .eq('debiteur_nr', doc.header.debiteur_nr)
        .maybeSingle(),
    ])

    if (orderRes.error) return json(500, { error: `Fetch orders: ${orderRes.error.message}` })
    const orderRows = (orderRes.data ?? []) as unknown as FactuurInvoiceOrder[]
    if (orderRows.length === 0) return json(404, { error: `Orders ${orderIds.join(',')} niet gevonden` })
    const orderById = new Map(orderRows.map((o) => [o.id, o]))
    const orders = orderIds.map((id) => orderById.get(id)).filter((o): o is FactuurInvoiceOrder => !!o)
    if (debiteurRes.error) return json(500, { error: `Fetch debiteur: ${debiteurRes.error.message}` })
    if (!debiteurRes.data) return json(404, { error: `Debiteur ${doc.header.debiteur_nr} niet gevonden` })
    if (configRes.error) return json(500, { error: `Fetch config: ${configRes.error.message}` })

    const cfg = configRes.data as ConfigRow | null
    if (!cfg?.transus_actief || !cfg?.factuur_uit) {
      return json(422, {
        error:
          `Debiteur ${doc.header.debiteur_nr} heeft factuur-EDI niet aan ` +
          `(factuur_uit=${cfg?.factuur_uit ?? false}, transus_actief=${cfg?.transus_actief ?? false}).`,
      })
    }

    // deliveryNoteNumber: zending-nr van de order, anders factuur_nr.
    const deliveryNoteNumber = (await zendingNrVoorOrder(sb, orderId)) ?? doc.header.factuur_nr

    const ctx: FactuurInvoiceContext = {
      bedrijf: {
        bedrijfsnaam: bedrijf.bedrijfsnaam,
        gln_eigen: bedrijf.gln_eigen ?? '8715954999998',
        adres: bedrijf.adres,
        postcode: bedrijf.postcode,
        plaats: bedrijf.plaats,
        land: bedrijf.land,
        btw_nummer: bedrijf.btw_nummer ?? null,
      },
      debiteur: debiteurRes.data as FactuurInvoiceContext['debiteur'],
      orders,
      deliveryNoteNumber,
    }
    // De handmatige knop volgt de test-modus van de partner (mirror auto-pad).
    const docMetTest = { ...doc, isTestMessage: cfg.test_modus ?? false }

    // Renderer/builder gooien bij ontbrekende GTIN of GLN — geef die 422 door.
    let payloadRaw: string
    try {
      payloadRaw = buildKarpiInvoiceFixedWidth(naarInvoiceInput(docMetTest, ctx))
    } catch (e) {
      return json(422, { error: e instanceof Error ? e.message : String(e) })
    }

    // Idempotent: bestaat er al een niet-gefaalde uitgaande factuur voor deze factuur?
    const { data: bestaand, error: bestaandErr } = await sb
      .from('edi_berichten')
      .select('id, status')
      .eq('richting', 'uit')
      .eq('berichttype', 'factuur')
      .eq('bron_tabel', 'facturen')
      .eq('bron_id', factuurId)
      .not('status', 'in', '("Fout","Geannuleerd")')
      .maybeSingle()
    if (bestaandErr) return json(500, { error: `Check bestaand: ${bestaandErr.message}` })
    if (bestaand?.id) {
      return json(200, { uitgaandId: bestaand.id, reedsAanwezig: true, status: bestaand.status })
    }

    const { data: outRow, error: insErr } = await sb
      .from('edi_berichten')
      .insert({
        richting: 'uit',
        berichttype: 'factuur',
        status: 'Wachtrij',
        debiteur_nr: doc.header.debiteur_nr,
        order_id: orderId,
        factuur_id: factuurId,
        bron_tabel: 'facturen',
        bron_id: factuurId,
        payload_raw: payloadRaw,
        payload_parsed: { format: 'karpi_fixed_width', berichttype: 'factuur' },
        is_test: cfg.test_modus ?? false,
      })
      .select('id')
      .single()
    if (insErr) return json(500, { error: `Insert edi_berichten: ${insErr.message}` })

    return json(200, { uitgaandId: outRow.id, reedsAanwezig: false, status: 'Wachtrij' })
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) })
  }
})

// deno-lint-ignore no-explicit-any
async function zendingNrVoorOrder(sb: any, orderId: number): Promise<string | null> {
  try {
    const { data, error } = await sb
      .from('zending_orders')
      .select('zendingen(zending_nr)')
      .eq('order_id', orderId)
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    const z = (data as unknown as { zendingen: { zending_nr: string } | null }).zendingen
    return z?.zending_nr ?? null
  } catch {
    return null
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}

interface ConfigRow {
  factuur_uit: boolean
  transus_actief: boolean
  test_modus: boolean | null
}
interface BedrijfConfig {
  bedrijfsnaam: string
  adres: string
  postcode: string
  plaats: string
  land: string
  btw_nummer?: string
  gln_eigen?: string
}
