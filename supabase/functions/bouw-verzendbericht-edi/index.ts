// Supabase Edge Function: bouw-verzendbericht-edi
//
// Zet uitgaande EDI-verzendberichten (DESADV) op de wachtrij voor partners die
// `transus_actief && verzend_uit` hebben in `edi_handelspartner_config`.
//
// Twee modi:
//   POST { order_id: number } — gericht: verwerk één order.
//   POST {}                  — sweep: verwerk alle EDI-orders met status='Verzonden'
//                              die nog geen actief verzendbericht hebben.
//
// Auth: ?token=<CRON_TOKEN> (zelfde patroon als transus-send/transus-poll, mig 305).
//
// De payload-builder (`buildKarpiVerzendbericht`) is gevalideerd byte-identiek
// tegen Transus-voorbeeld 172390327 (Hornbach NL, 2026-06-11) — zie de
// kolomkaart in _shared/transus-formats/karpi-verzendbericht.ts.
//
// Plan: docs/superpowers/plans/2026-06-11-universele-communicatie-knoppen.md (slice 4)
// Spiegelt: supabase/functions/bouw-factuur-edi/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  buildKarpiVerzendbericht,
  type VerzendberichtInput,
} from '../_shared/transus-formats/karpi-verzendbericht.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const KARPI_GLN_FALLBACK = '8715954999998'

// Sweep-venster: historische orders niet alsnog DESADV'en bij activatie.
// De cron draait */15 min — 7 dagen is ruim voldoende. Gerichte POST {order_id}
// omzeilt het venster bewust (geen lower-bound in verwerkOrder).
const SWEEP_VENSTER_DAGEN = 7

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  // Auth via ?token= (pg_cron patroon — zelfde als transus-send/transus-poll)
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const expectedToken = Deno.env.get('CRON_TOKEN')
  if (!expectedToken || token !== expectedToken) {
    return new Response('Unauthorized', { status: 401 })
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)

  let orderId = 0
  let rawOrderId: unknown = undefined
  try {
    const body = await req.json()
    rawOrderId = body?.order_id
    orderId = Number(rawOrderId ?? 0)
  } catch {
    // geen body of geen order_id → sweep-modus
  }

  // M1: aanwezige maar ongeldige order_id → 400 (geen stille fallback naar sweep)
  if (rawOrderId !== undefined && rawOrderId !== null && !(Number.isFinite(orderId) && orderId > 0)) {
    return json(400, { error: `Ongeldig order_id: ${JSON.stringify(rawOrderId)} (verwacht positief geheel getal)` })
  }

  if (Number.isFinite(orderId) && orderId > 0) {
    // Gerichte modus: één order
    const result = await verwerkOrder(sb, orderId)
    return json(200, { verwerkt: 1, results: [result] })
  }

  // Sweep-modus: alle kandidaten
  const kandidaten = await zoekKandidaten(sb)
  if (!kandidaten.ok) {
    return json(500, { error: `Zoekfout kandidaten: ${kandidaten.error}` })
  }

  const results: VerwerkResult[] = []
  for (const id of kandidaten.ids) {
    results.push(await verwerkOrder(sb, id))
  }

  return json(200, { verwerkt: results.length, results })
})

// ---------------------------------------------------------------------------
// Kandidaten-zoeker
// ---------------------------------------------------------------------------

interface KandidatenResult {
  ok: boolean
  ids: number[]
  error?: string
}

/**
 * Geeft alle order-id's die een verzendbericht nodig hebben:
 * - partner heeft transus_actief && verzend_uit
 * - order.status = 'Verzonden' && order.bron_systeem = 'edi'
 * - nog geen actief (niet-Fout, niet-Geannuleerd) verzendbericht in edi_berichten
 */
async function zoekKandidaten(
  // deno-lint-ignore no-explicit-any
  sb: any,
): Promise<KandidatenResult> {
  // Stap 1: debiteuren met actieve EDI-verzendconfiguratie
  const { data: configs, error: cfgErr } = await sb
    .from('edi_handelspartner_config')
    .select('debiteur_nr')
    .eq('transus_actief', true)
    .eq('verzend_uit', true)
  if (cfgErr) return { ok: false, ids: [], error: cfgErr.message }
  if (!configs || configs.length === 0) return { ok: true, ids: [] }

  const debiteurNrs = (configs as Array<{ debiteur_nr: number }>).map((c) => c.debiteur_nr)

  // Stap 2: verzonden EDI-orders van deze debiteuren binnen het sweep-venster
  // (historische orders niet alsnog DESADV'en bij activatie; gerichte POST omzeilt dit)
  const sweepVanaf = new Date(Date.now() - SWEEP_VENSTER_DAGEN * 24 * 60 * 60 * 1000).toISOString()
  const { data: orders, error: ordErr } = await sb
    .from('orders')
    .select('id')
    .eq('status', 'Verzonden')
    .eq('bron_systeem', 'edi')
    .in('debiteur_nr', debiteurNrs)
    .gte('verzonden_at', sweepVanaf)
  if (ordErr) return { ok: false, ids: [], error: ordErr.message }
  if (!orders || orders.length === 0) return { ok: true, ids: [] }

  const alleIds = (orders as Array<{ id: number }>).map((o) => o.id)

  // Stap 3: filter weg welke al een actief verzendbericht hebben
  const { data: bestaande, error: bestaandeErr } = await sb
    .from('edi_berichten')
    .select('bron_id')
    .eq('richting', 'uit')
    .eq('berichttype', 'verzendbericht')
    .eq('bron_tabel', 'orders')
    .in('bron_id', alleIds)
    .not('status', 'in', '("Fout","Geannuleerd")')
  if (bestaandeErr) return { ok: false, ids: [], error: bestaandeErr.message }

  const reedsVerwerkt = new Set(
    ((bestaande ?? []) as Array<{ bron_id: number }>).map((b) => b.bron_id),
  )
  const kandidaatIds = alleIds.filter((id) => !reedsVerwerkt.has(id))
  return { ok: true, ids: kandidaatIds }
}

// ---------------------------------------------------------------------------
// Order-verwerker
// ---------------------------------------------------------------------------

interface VerwerkResult {
  order_id: number
  status: 'wachtrij' | 'al_aanwezig' | 'overgeslagen' | 'skip_geen_fysieke_regels' | 'fout'
  uitgaandId?: number
  error?: string
}

// deno-lint-ignore no-explicit-any
async function verwerkOrder(sb: any, orderId: number): Promise<VerwerkResult> {
  try {
    // 1. Haal order op
    const { data: order, error: ordErr } = await sb
      .from('orders')
      .select(
        'id, order_nr, orderdatum, afleverdatum, klant_referentie, status, bron_systeem, ' +
          'debiteur_nr, ' +
          'besteller_gln, factuuradres_gln, afleveradres_gln, ' +
          // expliciete FK-hint: orders↔debiteuren heeft twee relaties
          // (debiteur_nr én betaler) — kale 'debiteuren' geeft PGRST201
          'debiteuren!orders_debiteur_nr_fkey(naam)',
      )
      .eq('id', orderId)
      .maybeSingle()
    if (ordErr) return { order_id: orderId, status: 'fout', error: `Fetch order: ${ordErr.message}` }
    if (!order) return { order_id: orderId, status: 'fout', error: `Order ${orderId} niet gevonden` }
    if (order.bron_systeem !== 'edi') {
      return { order_id: orderId, status: 'overgeslagen', error: 'Geen EDI-order' }
    }
    if (order.status !== 'Verzonden') {
      return { order_id: orderId, status: 'overgeslagen', error: `Status is '${order.status}', verwacht 'Verzonden'` }
    }

    // 2. Haal partner-config op
    const { data: cfg, error: cfgErr } = await sb
      .from('edi_handelspartner_config')
      .select('transus_actief, verzend_uit, test_modus')
      .eq('debiteur_nr', order.debiteur_nr)
      .maybeSingle()
    if (cfgErr) return { order_id: orderId, status: 'fout', error: `Fetch config: ${cfgErr.message}` }
    if (!cfg?.transus_actief || !cfg?.verzend_uit) {
      return {
        order_id: orderId,
        status: 'overgeslagen',
        error: `EDI-verzending niet actief (transus_actief=${cfg?.transus_actief ?? false}, verzend_uit=${cfg?.verzend_uit ?? false})`,
      }
    }

    // 3. Klant-PO: mirrors bouw-factuur-edi → orders.klant_referentie
    //    (snapshot van het inkomende EDI-bericht-ordernummer, gezet door create_edi_order)
    const orderNumberBuyer = order.klant_referentie ?? ''
    if (!orderNumberBuyer) {
      return { order_id: orderId, status: 'fout', error: 'klant_referentie (klant-PO) ontbreekt op order' }
    }

    // 4. Zending ophalen via zending_orders → zendingen
    //    kolommen: zending_nr, verzenddatum
    //    (track_trace heeft géén slot in het fixed-width DESADV-format — zie
    //    kolomkaart in karpi-verzendbericht.ts)
    const zending = await haalZendingOp(sb, orderId)

    // 5. Karpi-GLN uit app_config bedrijfsgegevens
    const { data: bedrijfRow } = await sb
      .from('app_config')
      .select('waarde')
      .eq('sleutel', 'bedrijfsgegevens')
      .maybeSingle()
    const bedrijf = (bedrijfRow?.waarde ?? {}) as { gln_eigen?: string }
    const senderGln = bedrijf.gln_eigen ?? KARPI_GLN_FALLBACK

    // 6. GTIN's ophalen voor de orderregels
    const { data: regelRows, error: regelErr } = await sb
      .from('order_regels')
      // expliciete FK-hint: order_regels↔producten heeft twee relaties
      // (artikelnr én fysiek_artikelnr, mig 154) — kale 'producten' geeft
      // PGRST201. DESADV toont het ORIGINELE artikel (omsticker is intern,
      // zelfde regel als de factuur).
      .select('id, regelnummer, artikelnr, omschrijving, orderaantal, producten!order_regels_artikelnr_fkey(ean_code, is_pseudo)')
      .eq('order_id', orderId)
      .gt('orderaantal', 0)
      .order('regelnummer')
    if (regelErr) return { order_id: orderId, status: 'fout', error: `Fetch regels: ${regelErr.message}` }

    // Fysiek document — admin-pseudo/VERZEND-regels horen er niet op (ADR-0018)
    const regels = ((regelRows ?? []) as OrderRegelRow[])
      .filter((r) => Number(r.orderaantal) > 0 && !r.producten?.is_pseudo)
      .map((r, idx) => ({
        regelnummer: r.regelnummer ?? idx + 1,
        gtin: r.producten?.ean_code ?? null,
        artikelcode: r.artikelnr ?? null,
        omschrijving: r.omschrijving ?? null,
        aantal: Number(r.orderaantal),
      }))

    if (regels.length === 0) {
      return { order_id: orderId, status: 'skip_geen_fysieke_regels' as const }
    }

    // 7. Bouw VerzendberichtInput
    //    recipientGln (UNB-routering) = factuuradres_gln — spiegelt factuur-mapper.ts
    const partnerNaam = (order.debiteuren as { naam: string | null } | null)?.naam ?? null
    const input: VerzendberichtInput = {
      zendingNr: zending?.zending_nr ?? order.order_nr,
      verzenddatum: zending?.verzenddatum ?? new Date().toISOString().slice(0, 10),
      leverdatum: order.afleverdatum ?? '',
      orderNumberBuyer,
      orderNumberSupplier: order.order_nr,
      partnerNaam,
      senderGln,
      recipientGln: order.factuuradres_gln ?? '',
      buyerGln: order.besteller_gln ?? '',
      deliveryPartyGln: order.afleveradres_gln ?? '',
      isTestMessage: cfg.test_modus ?? false,
      regels,
    }

    // 8. Idempotent check: is er al een actief verzendbericht voor deze order?
    const { data: bestaand, error: bestaandErr } = await sb
      .from('edi_berichten')
      .select('id, status')
      .eq('richting', 'uit')
      .eq('berichttype', 'verzendbericht')
      .eq('bron_tabel', 'orders')
      .eq('bron_id', orderId)
      .not('status', 'in', '("Fout","Geannuleerd")')
      .maybeSingle()
    if (bestaandErr) return { order_id: orderId, status: 'fout', error: `Check bestaand: ${bestaandErr.message}` }
    if (bestaand?.id) {
      return { order_id: orderId, status: 'al_aanwezig', uitgaandId: bestaand.id }
    }

    // 9. Bouw bericht (gooit bij validatiefouten, bv. regel zonder GTIN)
    let payloadRaw: string
    try {
      payloadRaw = buildKarpiVerzendbericht(input)
    } catch (e) {
      // Validatiefout (ontbrekende GLN/GTIN/datum) — geen insert in
      // edi_berichten: geen payload_raw beschikbaar. Resultaat: per-order
      // error-result in de response; sweep probeert het volgende keer opnieuw
      // zodra de data compleet is.
      const errorMsg = e instanceof Error ? e.message : String(e)
      return { order_id: orderId, status: 'fout', error: errorMsg }
    }

    // 10. Insert in edi_berichten (Wachtrij — transus-send pakt het op)
    const { data: outRow, error: insErr } = await sb
      .from('edi_berichten')
      .insert({
        richting: 'uit',
        berichttype: 'verzendbericht',
        status: 'Wachtrij',
        debiteur_nr: order.debiteur_nr,
        order_id: orderId,
        bron_tabel: 'orders',
        bron_id: orderId,
        payload_raw: payloadRaw,
        payload_parsed: { format: 'karpi_verzendbericht', input },
        is_test: cfg.test_modus ?? false,
      })
      .select('id')
      .single()
    if (insErr) return { order_id: orderId, status: 'fout', error: `Insert edi_berichten: ${insErr.message}` }

    return { order_id: orderId, status: 'wachtrij', uitgaandId: outRow.id }
  } catch (e) {
    return { order_id: orderId, status: 'fout', error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ZendingData {
  zending_nr: string
  verzenddatum: string | null
}

/**
 * Haalt de eerste zending op voor een order via zending_orders → zendingen.
 * Mirrors de aanpak in bouw-factuur-edi (zendingNrVoorOrder).
 */
// deno-lint-ignore no-explicit-any
async function haalZendingOp(sb: any, orderId: number): Promise<ZendingData | null> {
  try {
    const { data, error } = await sb
      .from('zending_orders')
      .select('zendingen(zending_nr, verzenddatum)')
      .eq('order_id', orderId)
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    const z = (data as unknown as { zendingen: ZendingData | null }).zendingen
    return z ?? null
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

// ---------------------------------------------------------------------------
// Type-helpers
// ---------------------------------------------------------------------------

interface OrderRegelRow {
  id: number
  regelnummer: number | null
  artikelnr: string | null
  omschrijving: string | null
  orderaantal: number | string
  producten: { ean_code: string | null; is_pseudo: boolean | null } | null
}
