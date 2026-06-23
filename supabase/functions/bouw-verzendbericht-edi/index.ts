// Supabase Edge Function: bouw-verzendbericht-edi
//
// Zet uitgaande EDI-verzendberichten (DESADV) op de wachtrij voor partners die
// `transus_actief && verzend_uit` hebben in `edi_handelspartner_config`.
//
// Eenheid is de FYSIEKE ZENDING, niet de order (mig 475, 2026-06-22). Eén
// order kan ≥2 zendingen hebben (deelzending) — elke zending krijgt zijn eigen
// DESADV, met alleen de regels/aantallen die in DIE zending daadwerkelijk
// verzonden zijn (`zending_regels`, niet `order_regels.orderaantal`). Een
// bundel-zending (mig 222, meerdere orders in 1 fysieke zending) levert per
// betrokken order een eigen DESADV op (elke order heeft een eigen klant-PO/
// GLN's — onvermijdelijk EDI-gegeven, geen keuze).
//
// Twee modi:
//   POST { zending_id: number } — gericht: verwerk één zending (alle
//                                  betrokken orders), omzeilt het sweep-venster.
//   POST {}                    — sweep: alle (zending, order)-paren waarvan de
//                                 zending `gereed_op` (eerste moment 'Klaar
//                                 voor verzending') binnen het venster heeft en
//                                 nog geen actief verzendbericht heeft.
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
import { externReferentie } from '../_shared/referentie.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const KARPI_GLN_FALLBACK = '8715954999998'

// Sweep-venster: historische zendingen niet alsnog DESADV'en bij activatie.
// De cron draait */15 min — 7 dagen is ruim voldoende. Gerichte POST {zending_id}
// omzeilt het venster bewust (geen lower-bound in verwerkZendingOrder).
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

  let zendingId = 0
  let rawZendingId: unknown = undefined
  try {
    const body = await req.json()
    rawZendingId = body?.zending_id
    zendingId = Number(rawZendingId ?? 0)
  } catch {
    // geen body of geen zending_id → sweep-modus
  }

  // Aanwezige maar ongeldige zending_id → 400 (geen stille fallback naar sweep)
  if (rawZendingId !== undefined && rawZendingId !== null && !(Number.isFinite(zendingId) && zendingId > 0)) {
    return json(400, { error: `Ongeldig zending_id: ${JSON.stringify(rawZendingId)} (verwacht positief geheel getal)` })
  }

  if (Number.isFinite(zendingId) && zendingId > 0) {
    // Gerichte modus: één zending, alle betrokken orders (bundel-aware)
    const { data: zoRows, error: zoErr } = await sb
      .from('zending_orders')
      .select('order_id')
      .eq('zending_id', zendingId)
    if (zoErr) return json(500, { error: `Fetch zending_orders: ${zoErr.message}` })
    if (!zoRows || zoRows.length === 0) {
      return json(404, { error: `Zending ${zendingId} heeft geen gekoppelde orders` })
    }
    const results: VerwerkResult[] = []
    for (const row of zoRows as Array<{ order_id: number }>) {
      results.push(await verwerkZendingOrder(sb, zendingId, row.order_id))
    }
    return json(200, { verwerkt: results.length, results })
  }

  // Sweep-modus: alle (zending, order)-kandidaten
  const kandidaten = await zoekKandidaten(sb)
  if (!kandidaten.ok) {
    return json(500, { error: `Zoekfout kandidaten: ${kandidaten.error}` })
  }

  const results: VerwerkResult[] = []
  for (const paar of kandidaten.paren) {
    results.push(await verwerkZendingOrder(sb, paar.zending_id, paar.order_id))
  }

  return json(200, { verwerkt: results.length, results })
})

// ---------------------------------------------------------------------------
// Kandidaten-zoeker
// ---------------------------------------------------------------------------

interface ZendingOrderPaar {
  zending_id: number
  order_id: number
}

interface KandidatenResult {
  ok: boolean
  paren: ZendingOrderPaar[]
  error?: string
}

/**
 * Geeft alle (zending, order)-paren die een verzendbericht nodig hebben:
 * - partner heeft transus_actief && verzend_uit
 * - order.bron_systeem = 'edi'
 * - zending.gereed_op IS NOT NULL (= ooit 'Klaar voor verzending' bereikt,
 *   blijft staan ook als de zending later naar Onderweg/Afgeleverd gaat) en
 *   binnen het sweep-venster
 * - nog geen actief (niet-Fout, niet-Geannuleerd) verzendbericht voor dit
 *   exacte (order_id, zending_id)-paar in edi_berichten
 *
 * Bewust NIET gefilterd op orders.status: een deelzending bereikt
 * 'Klaar voor verzending' vaak terwijl de ORDER nog op 'Deels verzonden'
 * staat (mig 474) — de zending is het juiste trigger-moment, niet de order.
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
  if (cfgErr) return { ok: false, paren: [], error: cfgErr.message }
  if (!configs || configs.length === 0) return { ok: true, paren: [] }

  const debiteurNrs = (configs as Array<{ debiteur_nr: number }>).map((c) => c.debiteur_nr)

  // Stap 2: (zending, order)-paren van EDI-orders van deze debiteuren, waarvan
  // de zending binnen het sweep-venster gereed is. Embedded filters via
  // !inner forceren de join-conditie op orders/zendingen-kolommen.
  const sweepVanaf = new Date(Date.now() - SWEEP_VENSTER_DAGEN * 24 * 60 * 60 * 1000).toISOString()
  const { data: rows, error: rowsErr } = await sb
    .from('zending_orders')
    .select('zending_id, order_id, orders!inner(bron_systeem, debiteur_nr, status), zendingen!inner(gereed_op)')
    .eq('orders.bron_systeem', 'edi')
    .neq('orders.status', 'Geannuleerd')
    .in('orders.debiteur_nr', debiteurNrs)
    .not('zendingen.gereed_op', 'is', null)
    .gte('zendingen.gereed_op', sweepVanaf)
  if (rowsErr) return { ok: false, paren: [], error: rowsErr.message }
  if (!rows || rows.length === 0) return { ok: true, paren: [] }

  const alleParen: ZendingOrderPaar[] = (rows as Array<{ zending_id: number; order_id: number }>).map(
    (r) => ({ zending_id: r.zending_id, order_id: r.order_id }),
  )

  // Stap 3: filter weg welke (order, zending)-paren al een actief verzendbericht hebben
  const orderIds = [...new Set(alleParen.map((p) => p.order_id))]
  const { data: bestaande, error: bestaandeErr } = await sb
    .from('edi_berichten')
    .select('order_id, zending_id')
    .eq('richting', 'uit')
    .eq('berichttype', 'verzendbericht')
    .in('order_id', orderIds)
    .not('status', 'in', '("Fout","Geannuleerd")')
  if (bestaandeErr) return { ok: false, paren: [], error: bestaandeErr.message }

  const reedsVerwerkt = new Set(
    ((bestaande ?? []) as Array<{ order_id: number; zending_id: number | null }>).map(
      (b) => `${b.order_id}:${b.zending_id}`,
    ),
  )
  const kandidaatParen = alleParen.filter((p) => !reedsVerwerkt.has(`${p.order_id}:${p.zending_id}`))
  return { ok: true, paren: kandidaatParen }
}

// ---------------------------------------------------------------------------
// Zending×order-verwerker
// ---------------------------------------------------------------------------

interface VerwerkResult {
  zending_id: number
  order_id: number
  status: 'wachtrij' | 'al_aanwezig' | 'overgeslagen' | 'skip_geen_fysieke_regels' | 'fout'
  uitgaandId?: number
  error?: string
}

// deno-lint-ignore no-explicit-any
async function verwerkZendingOrder(sb: any, zendingId: number, orderId: number): Promise<VerwerkResult> {
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
    if (ordErr) return { zending_id: zendingId, order_id: orderId, status: 'fout', error: `Fetch order: ${ordErr.message}` }
    if (!order) return { zending_id: zendingId, order_id: orderId, status: 'fout', error: `Order ${orderId} niet gevonden` }
    if (order.bron_systeem !== 'edi') {
      return { zending_id: zendingId, order_id: orderId, status: 'overgeslagen', error: 'Geen EDI-order' }
    }
    if (order.status === 'Geannuleerd') {
      return { zending_id: zendingId, order_id: orderId, status: 'overgeslagen', error: 'Order is geannuleerd' }
    }

    // 2. Haal partner-config op
    const { data: cfg, error: cfgErr } = await sb
      .from('edi_handelspartner_config')
      .select('transus_actief, verzend_uit, test_modus')
      .eq('debiteur_nr', order.debiteur_nr)
      .maybeSingle()
    if (cfgErr) return { zending_id: zendingId, order_id: orderId, status: 'fout', error: `Fetch config: ${cfgErr.message}` }
    if (!cfg?.transus_actief || !cfg?.verzend_uit) {
      return {
        zending_id: zendingId,
        order_id: orderId,
        status: 'overgeslagen',
        error: `EDI-verzending niet actief (transus_actief=${cfg?.transus_actief ?? false}, verzend_uit=${cfg?.verzend_uit ?? false})`,
      }
    }

    // 3. Klant-PO: mirrors bouw-factuur-edi → orders.klant_referentie
    //    (snapshot van het inkomende EDI-bericht-ordernummer, gezet door create_edi_order)
    const orderNumberBuyer = externReferentie(order.klant_referentie) ?? ''
    if (!orderNumberBuyer) {
      return { zending_id: zendingId, order_id: orderId, status: 'fout', error: 'klant_referentie (klant-PO) ontbreekt op order' }
    }

    // 4. Deze specifieke zending ophalen — geen giswerk meer welke zending
    //    "de" zending is (oude `.limit(1)` zonder ORDER BY).
    const { data: zending, error: zendErr } = await sb
      .from('zendingen')
      .select('zending_nr, verzenddatum')
      .eq('id', zendingId)
      .maybeSingle()
    if (zendErr) return { zending_id: zendingId, order_id: orderId, status: 'fout', error: `Fetch zending: ${zendErr.message}` }
    if (!zending) return { zending_id: zendingId, order_id: orderId, status: 'fout', error: `Zending ${zendingId} niet gevonden` }

    // 5. Karpi-GLN uit app_config bedrijfsgegevens
    const { data: bedrijfRow } = await sb
      .from('app_config')
      .select('waarde')
      .eq('sleutel', 'bedrijfsgegevens')
      .maybeSingle()
    const bedrijf = (bedrijfRow?.waarde ?? {}) as { gln_eigen?: string }
    const senderGln = bedrijf.gln_eigen ?? KARPI_GLN_FALLBACK

    // 6. Regels: uit zending_regels (wat in DEZE zending fysiek verzonden is),
    //    niet uit order_regels.orderaantal (het volledige bestelde aantal).
    //    Admin-pseudo/VERZEND-regels komen er door trg_zending_regels_skip_admin_pseudo
    //    (mig 434) nooit in — de is_pseudo-check hieronder is defensief.
    //    DESADV toont het ORIGINELE artikel (omsticker is intern, zelfde regel
    //    als de factuur) — vandaar de join via order_regels.artikelnr, niet
    //    zending_regels.artikelnr.
    const { data: regelRows, error: regelErr } = await sb
      .from('zending_regels')
      .select(
        'aantal, ' +
          'order_regels!inner(id, order_id, regelnummer, artikelnr, omschrijving, producten!order_regels_artikelnr_fkey(ean_code, is_pseudo))',
      )
      .eq('zending_id', zendingId)
      .eq('order_regels.order_id', orderId)
    if (regelErr) return { zending_id: zendingId, order_id: orderId, status: 'fout', error: `Fetch regels: ${regelErr.message}` }

    // Eén order_regel kan meerdere zending_regels-rijen hebben (bv. verdeeld
    // over meerdere rollen) — som het werkelijk-verzonden aantal per regel.
    const totalenPerRegel = new Map<
      number,
      { regelnummer: number | null; artikelnr: string | null; omschrijving: string | null; gtin: string | null; aantal: number }
    >()
    for (const row of (regelRows ?? []) as ZendingRegelRow[]) {
      const orRegel = row.order_regels
      if (!orRegel || orRegel.producten?.is_pseudo) continue
      const aantal = Number(row.aantal ?? 0)
      const bestaand = totalenPerRegel.get(orRegel.id)
      if (bestaand) {
        bestaand.aantal += aantal
      } else {
        totalenPerRegel.set(orRegel.id, {
          regelnummer: orRegel.regelnummer,
          artikelnr: orRegel.artikelnr,
          omschrijving: orRegel.omschrijving,
          gtin: orRegel.producten?.ean_code ?? null,
          aantal,
        })
      }
    }
    const regels = Array.from(totalenPerRegel.values())
      .filter((r) => r.aantal > 0)
      .sort((a, b) => (a.regelnummer ?? 0) - (b.regelnummer ?? 0))
      .map((r, idx) => ({
        regelnummer: r.regelnummer ?? idx + 1,
        gtin: r.gtin,
        artikelcode: r.artikelnr,
        omschrijving: r.omschrijving,
        aantal: r.aantal,
      }))

    if (regels.length === 0) {
      return { zending_id: zendingId, order_id: orderId, status: 'skip_geen_fysieke_regels' as const }
    }

    // 7. Bouw VerzendberichtInput
    //    recipientGln (UNB-routering) = factuuradres_gln — spiegelt factuur-invoice-renderer.ts
    const partnerNaam = (order.debiteuren as { naam: string | null } | null)?.naam ?? null
    const input: VerzendberichtInput = {
      zendingNr: zending.zending_nr,
      verzenddatum: zending.verzenddatum ?? new Date().toISOString().slice(0, 10),
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

    // 8. Idempotent check: is er al een actief verzendbericht voor dit exacte
    //    (order, zending)-paar? (DB-niveau afgedwongen door mig 475's
    //    uk_edi_berichten_verzendbericht_actief — dit is de snelle vooraf-check.)
    const { data: bestaand, error: bestaandErr } = await sb
      .from('edi_berichten')
      .select('id, status')
      .eq('richting', 'uit')
      .eq('berichttype', 'verzendbericht')
      .eq('order_id', orderId)
      .eq('zending_id', zendingId)
      .not('status', 'in', '("Fout","Geannuleerd")')
      .maybeSingle()
    if (bestaandErr) return { zending_id: zendingId, order_id: orderId, status: 'fout', error: `Check bestaand: ${bestaandErr.message}` }
    if (bestaand?.id) {
      return { zending_id: zendingId, order_id: orderId, status: 'al_aanwezig', uitgaandId: bestaand.id }
    }

    // 9. Bouw bericht (gooit bij validatiefouten, bv. regel zonder GTIN)
    let payloadRaw: string
    try {
      payloadRaw = buildKarpiVerzendbericht(input)
    } catch (e) {
      // Validatiefout (ontbrekende GLN/GTIN/datum) — geen insert in
      // edi_berichten: geen payload_raw beschikbaar. Resultaat: per-paar
      // error-result in de response; sweep probeert het volgende keer opnieuw
      // zodra de data compleet is.
      const errorMsg = e instanceof Error ? e.message : String(e)
      return { zending_id: zendingId, order_id: orderId, status: 'fout', error: errorMsg }
    }

    // 10. Insert in edi_berichten (Wachtrij — transus-send pakt het op)
    //     bron_tabel/bron_id blijven 'orders'/order_id (backward-compat met de
    //     generieke EDI-overzicht-UI); zending_id is de échte idempotentie-as
    //     (mig 475).
    const { data: outRow, error: insErr } = await sb
      .from('edi_berichten')
      .insert({
        richting: 'uit',
        berichttype: 'verzendbericht',
        status: 'Wachtrij',
        debiteur_nr: order.debiteur_nr,
        order_id: orderId,
        zending_id: zendingId,
        bron_tabel: 'orders',
        bron_id: orderId,
        payload_raw: payloadRaw,
        payload_parsed: { format: 'karpi_verzendbericht', input },
        is_test: cfg.test_modus ?? false,
      })
      .select('id')
      .single()
    if (insErr) return { zending_id: zendingId, order_id: orderId, status: 'fout', error: `Insert edi_berichten: ${insErr.message}` }

    return { zending_id: zendingId, order_id: orderId, status: 'wachtrij', uitgaandId: outRow.id }
  } catch (e) {
    return { zending_id: zendingId, order_id: orderId, status: 'fout', error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Type-helpers
// ---------------------------------------------------------------------------

interface ZendingRegelRow {
  aantal: number | string
  order_regels: {
    id: number
    order_id: number
    regelnummer: number | null
    artikelnr: string | null
    omschrijving: string | null
    producten: { ean_code: string | null; is_pseudo: boolean | null } | null
  } | null
}
