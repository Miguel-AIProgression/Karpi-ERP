// Gedeelde verwerkingslogica voor Shopify-orders.
// Wordt gebruikt door zowel sync-shopify-order (webhook) als
// sync-shopify-orders-poll (geplande polling via Admin API).
//
// processShopifyOrder() doet: idempotentie-check → debiteur-matching →
// orderregels bouwen → adres/afleverdatum afleiden → create_webshop_order RPC.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  extractShopifyShippingAddress,
  extractShopifyBillingAddress,
  shopifyLineItemToMatcherRow,
  groepeerVoSelectionsItems,
  type ShopifyOrderWebhook,
} from './shopify-types.ts'
import { matchDebiteur } from './shopify-debiteur-matcher.ts'
import { matchProduct, buildOmschrijving } from './product-matcher.ts'
import { parseMaatwerkDims } from './order-matcher.ts'
import { haalKlantPrijs } from './klant-prijs.ts'
import { regelBedrag } from './order-intake/regel-bedrag.ts'
import { logExternePayload, markeerExternePayload } from './externe-payload-audit.ts'

type SupabaseClient = ReturnType<typeof createClient>

export interface ProcessResult {
  order_nr: string | null
  was_existing: boolean
  debiteur_nr: number | null
  debiteur_bron: string | null
  matched: number
  unmatched: number
  skipped_reason?: string
}

// Shopify levert gewicht in gram; normalizeGewicht verwacht micro-kg.
// We skippen de micro-kg conversie: gram × 1000 = milli-gram is dicht genoeg
// voor de /1_000_000 → kg formule in sync-webshop-order (geeft milli-kg → kg).
function gramsToMicroKg(grams: number | null | undefined): number | undefined {
  if (grams == null) return undefined
  return Math.round(grams * 1000)
}

function normalizeGewicht(microKg: number | undefined): number | null {
  if (microKg == null || isNaN(microKg)) return null
  const kg = microKg / 1_000_000
  if (kg >= 1_000_000 || kg < 0) return null
  return Math.round(kg * 100) / 100
}

async function buildRegels(
  supabase: SupabaseClient,
  order: ShopifyOrderWebhook,
  debiteurNr: number,
): Promise<{ regels: unknown[]; matched: number; unmatched: number }> {
  const regels: unknown[] = []
  let matched = 0
  let unmatched = 0

  // Debiteurenkorting eenmalig ophalen — geldt voor alle productenregels,
  // maar NIET voor verzend-/admin-pseudo-regels (VERZEND, VORMTOESLAG etc.).
  const { data: debRow } = await supabase
    .from('debiteuren')
    .select('korting_pct')
    .eq('debiteur_nr', debiteurNr)
    .maybeSingle()
  const debiteurKortingPct: number = Number(debRow?.korting_pct ?? 0)

  for (const item of groepeerVoSelectionsItems(order.line_items)) {
    // Verzendregels van Shopify niet als orderregel importeren — die komen
    // uit shipping_lines en worden apart verwerkt.
    if (item.requires_shipping === false && /verzend|verzending|shipping/i.test(item.title)) {
      continue
    }

    const matcherRow = shopifyLineItemToMatcherRow(item)
    const match = await matchProduct(supabase, matcherRow, debiteurNr)

    const omschrijving = buildOmschrijving(matcherRow, match)

    if (match.artikelnr || match.is_maatwerk) matched++
    else unmatched++

    // Hergebruik dezelfde dims-parser als de mail-import (parseMaatwerkDims) —
    // die kijkt ook naar `extraTexts` (Shopify line-item properties als
    // "Maatwerk: 260x250 rechthoek"), niet alleen variant_title/expliciete
    // lengte+breedte-properties zoals de eerdere bespoke parsing hier deed.
    // Eén parser voor alle orderbronnen voorkomt dat Shopify-orders dimensies
    // missen die de mail-import wél correct had herkend.
    let maatwerk_lengte_cm: number | null = null
    let maatwerk_breedte_cm: number | null = null
    if (match.is_maatwerk) {
      const dims = parseMaatwerkDims(matcherRow)
      if (dims) {
        maatwerk_lengte_cm = dims.lengte
        maatwerk_breedte_cm = dims.breedte
      }
    }

    const aantal = item.quantity
    const klantPrijs = await haalKlantPrijs(supabase, debiteurNr, match.artikelnr, {
      is_maatwerk: match.is_maatwerk,
      lengte_cm: maatwerk_lengte_cm,
      breedte_cm: maatwerk_breedte_cm,
    })
    const prijs = klantPrijs.prijs
    const bedrag = regelBedrag(prijs, aantal, debiteurKortingPct)

    regels.push({
      artikelnr: match.artikelnr,
      omschrijving,
      omschrijving_2: item.variant_title ?? null,
      orderaantal: aantal,
      te_leveren: aantal,
      prijs,
      korting_pct: debiteurKortingPct,
      bedrag,
      gewicht_kg: normalizeGewicht(gramsToMicroKg(item.grams)),
      is_maatwerk: match.is_maatwerk ?? false,
      maatwerk_kwaliteit_code: match.maatwerk_kwaliteit_code ?? null,
      maatwerk_kleur_code: match.maatwerk_kleur_code ?? null,
      maatwerk_vorm: match.maatwerk_vorm ?? null,
      maatwerk_lengte_cm,
      maatwerk_breedte_cm,
    })
  }

  for (const sl of order.shipping_lines ?? []) {
    const bedragVerzend = parseFloat(sl.price ?? '0') || 0
    if (bedragVerzend > 0) {
      regels.push({
        artikelnr: 'VERZEND',
        omschrijving: sl.title ?? 'Verzendkosten',
        omschrijving_2: null,
        orderaantal: 1,
        te_leveren: 1,
        prijs: bedragVerzend,
        korting_pct: 0,
        bedrag: bedragVerzend,
        gewicht_kg: null,
        is_maatwerk: false,
        maatwerk_kwaliteit_code: null,
        maatwerk_kleur_code: null,
        maatwerk_vorm: null,
        maatwerk_lengte_cm: null,
        maatwerk_breedte_cm: null,
      })
    }
  }

  return { regels, matched, unmatched }
}

function leidAfleverdatumAf(order: ShopifyOrderWebhook, orderdatum: string): string {
  for (const attr of order.note_attributes ?? []) {
    if (/afleverdatum|leverdatum|delivery.?date|gewenste.?datum/i.test(attr.name)) {
      const nlMatch = attr.value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
      if (nlMatch) {
        return `${nlMatch[3]}-${nlMatch[2].padStart(2, '0')}-${nlMatch[1].padStart(2, '0')}`
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(attr.value)) {
        return attr.value
      }
      break
    }
  }
  // Standaard: 7 kalenderdagen na orderdatum (veilige buffer voor B2B)
  const d = new Date(orderdatum)
  d.setDate(d.getDate() + 7)
  return d.toISOString().slice(0, 10)
}

/**
 * Verwerkt één Shopify-order tot een RugFlow-order. Idempotent op
 * (bron_systeem='shopify', bron_order_id) — bestaande orders worden overgeslagen.
 *
 * @param shopDomain  het *.myshopify.com-domein waar de order vandaan komt
 *                    (uit webhook-header X-Shopify-Shop-Domain, of de poll-config)
 */
export async function processShopifyOrder(
  supabase: SupabaseClient,
  order: ShopifyOrderWebhook,
  shopDomain: string,
): Promise<ProcessResult> {
  const orderId = order.id
  if (!orderId) {
    return { order_nr: null, was_existing: false, debiteur_nr: null, debiteur_bron: null, matched: 0, unmatched: 0, skipped_reason: 'Missing order.id' }
  }

  const { data: existing } = await supabase
    .from('orders')
    .select('order_nr')
    .eq('bron_systeem', 'shopify')
    .eq('bron_order_id', String(orderId))
    .limit(1)

  if (existing && existing.length > 0) {
    return {
      order_nr: existing[0].order_nr,
      was_existing: true,
      debiteur_nr: null,
      debiteur_bron: null,
      matched: 0,
      unmatched: 0,
    }
  }

  // Rauwe-payload-audit (mig 324/325): bewaar de letterlijke Shopify-order zodat
  // een latere intake-fout (ontbrekend adres, mismatch) reconstrueerbaar is.
  // Pas NA de idempotentie-check zodat de poll-cron niet elke ronde een dubbele
  // audit-rij voor een al-verwerkte order maakt. Best-effort: blokkeert nooit.
  const payloadLogId = await logExternePayload(supabase, {
    kanaal: 'shopify',
    raw: JSON.stringify(order),
    bron: shopDomain,
    externeId: String(orderId),
    json: order,
  })

  const debiteurMatch = await matchDebiteur(supabase, order)
  if (!debiteurMatch) {
    await markeerExternePayload(supabase, payloadLogId, 'fout', {
      fout: 'Geen debiteur gevonden',
    })
    return {
      order_nr: null,
      was_existing: false,
      debiteur_nr: null,
      debiteur_bron: null,
      matched: 0,
      unmatched: 0,
      skipped_reason: 'Geen debiteur gevonden. Stel SHOPIFY_FALLBACK_DEBITEUR_NR in als catch-all.',
    }
  }

  const { regels, matched, unmatched } = await buildRegels(supabase, order, debiteurMatch.debiteur_nr)

  const { data: debiteurInfo } = await supabase
    .from('debiteuren')
    .select('naam')
    .eq('debiteur_nr', debiteurMatch.debiteur_nr)
    .single()
  const debiteurNaam = debiteurInfo?.naam ?? null

  const shipping = extractShopifyShippingAddress(order)
  const billing = extractShopifyBillingAddress(order)

  // Altijd bedrijfsnaam (debiteur.naam uit RugFlow) als eerste adresregel;
  // contactpersoon (Shopify first+last) als afl_naam_2. fact_naam idem.
  if (debiteurNaam) {
    const contactPersoon = shipping.afl_naam as string | null
    shipping.afl_naam = debiteurNaam
    if (contactPersoon && contactPersoon !== debiteurNaam) {
      shipping.afl_naam_2 = contactPersoon
    }
    billing.fact_naam = debiteurNaam
  }

  const orderdatum = order.created_at ? order.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10)
  const afleverdatum = leidAfleverdatumAf(order, orderdatum)
  // Interne referentie: klant-eigen PO + Shopify-ordernummer (bv. "#5590").
  // Het Shopify-gedeelte is puur intern — externReferentie() strips het op
  // alle externe documenten (pakbon, factuur, EDI, labels, orderbevestiging).
  const klantReferentie = order.note?.trim()
    ? `${order.note.trim()} / Shopify: ${order.name}`
    : `Shopify: ${order.name}`

  const header = {
    debiteur_nr: debiteurMatch.debiteur_nr,
    klant_referentie: klantReferentie,
    orderdatum,
    afleverdatum,
    ...shipping,
    ...billing,
    bron_systeem: 'shopify',
    bron_shop: shopDomain,
    bron_order_id: String(orderId),
    // Mig 322: een onzekere fuzzy match (bedrijfsnaam-deelmatch/e-mail) landt
    // wél als order maar wordt gemarkeerd als "debiteur te bevestigen" zodat de
    // operator hem via de banner op het orders-overzicht kan corrigeren —
    // i.p.v. stil op de gegokte debiteur te accepteren.
    debiteur_zeker: debiteurMatch.zeker,
    debiteur_match_bron: debiteurMatch.bron,
  }

  const { data, error } = await supabase.rpc('create_webshop_order', {
    p_header: header,
    p_regels: regels,
  })

  if (error) {
    await markeerExternePayload(supabase, payloadLogId, 'fout', {
      fout: `create_webshop_order: ${error.message}`,
    })
    throw new Error(`create_webshop_order: ${error.message}`)
  }

  const result = Array.isArray(data) && data.length > 0 ? data[0] : null

  // `data` is door de niet-gegenereerde RPC-typing als `never` getypt (zie de
  // pre-existing typecheck-ruis in dit bestand); lees het nieuwe order-id via
  // een lokale cast zodat de audit-koppeling werkt zonder een extra type-fout.
  const nieuwOrderId = (result as { id?: number } | null)?.id ?? null
  await markeerExternePayload(supabase, payloadLogId, 'verwerkt', { orderId: nieuwOrderId })

  return {
    order_nr: result?.order_nr ?? null,
    was_existing: result?.was_existing ?? false,
    debiteur_nr: debiteurMatch.debiteur_nr,
    debiteur_bron: debiteurMatch.bron,
    matched,
    unmatched,
  }
}
