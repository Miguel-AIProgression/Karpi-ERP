// Download-helper: bouw TransusXML orderbevestiging on-the-fly uit DB-state
// en trigger een browser-download.
//
// Plan: docs/superpowers/plans/2026-04-30-edi-handmatige-upload-download.md (fase 2)
//
// Aanpak: TransusXML heeft prijzen, descriptions en GTIN's nodig die pas na
// order-aanmaak betrouwbaar beschikbaar zijn (uit order_regels + producten).

import { supabase } from '@/lib/supabase/client'
import {
  buildOrderbevTransusXml,
  buildOrderResponseNumber,
  type OrderbevXmlInput,
  type OrderbevXmlArticle,
} from './transus-xml'

const KARPI_GLN_DEFAULT = '8715954999998'

export interface BerichtVoorXml {
  id: number
  order_id: number | null
  payload_parsed: Record<string, unknown> | null
  is_test: boolean
  order_response_seq: number | null
}

export interface OrderbevXmlBuildResult {
  filename: string
  xml: string
  input: OrderbevXmlInput
  seq: number
}

interface OrderVoorXml {
  id: number
  order_nr: string | null
  klant_referentie: string | null
  orderdatum: string | null
  afleverdatum: string | null
  factuuradres_gln: string | null
  besteller_gln: string | null
  afleveradres_gln: string | null
  debiteur_nr: number | null
  debiteuren?:
    | { btw_percentage?: number | string | null; btw_verlegd_intracom?: boolean | null }
    | { btw_percentage?: number | string | null; btw_verlegd_intracom?: boolean | null }[]
    | null
}

interface OrderRegelVoorXml {
  regelnummer: number | string | null
  artikelnr: string | null
  omschrijving: string | null
  orderaantal: number | string | null
  te_leveren: number | string | null
  prijs: number | string | null
  producten?: { ean_code?: string | null } | { ean_code?: string | null }[] | null
}

/**
 * Bouw TransusXML voor een uitgaand orderbev-bericht en trigger download.
 */
export async function downloadOrderbevAlsXml(
  bericht: BerichtVoorXml,
  options: { karpiGln?: string } = {},
): Promise<OrderbevXmlBuildResult> {
  const result = await bouwOrderbevXmlVoorBericht(bericht, options)
  triggerDownload(result.filename, result.xml, 'application/xml;charset=utf-8')
  return result
}

/**
 * Bouw TransusXML voor een uitgaand orderbev-bericht zonder browser-side effects.
 * Wordt gebruikt door de downloadknop en door de bevestig-flow die `payload_raw`
 * direct als XML op de uitgaande wachtrij zet.
 */
export async function bouwOrderbevXmlVoorBericht(
  bericht: BerichtVoorXml,
  options: { karpiGln?: string } = {},
): Promise<OrderbevXmlBuildResult> {
  if (!bericht.order_id) {
    throw new Error(
      'Dit uitgaande bericht heeft geen gekoppelde order_id; TransusXML niet te bouwen.',
    )
  }

  const karpiGln = options.karpiGln ?? KARPI_GLN_DEFAULT
  const seq = bericht.order_response_seq ?? 1

  const { data: order, error: ordErr } = await supabase
    .from('orders')
    .select(
      'id, order_nr, klant_referentie, orderdatum, afleverdatum, ' +
        'factuuradres_gln, besteller_gln, afleveradres_gln, debiteur_nr, ' +
        'debiteuren:debiteur_nr(btw_percentage, btw_verlegd_intracom)',
    )
    .eq('id', bericht.order_id)
    .single()
  if (ordErr) throw ordErr
  if (!order) throw new Error(`Order ${bericht.order_id} niet gevonden.`)
  const orderRow = order as unknown as OrderVoorXml

  const { data: regels, error: regErr } = await supabase
    .from('order_regels')
    .select(
      'regelnummer, artikelnr, omschrijving, orderaantal, te_leveren, prijs, ' +
        'producten!order_regels_artikelnr_fkey(ean_code)',
    )
    .eq('order_id', bericht.order_id)
    .order('regelnummer', { ascending: true })
  if (regErr) throw regErr
  if (!regels || regels.length === 0) {
    throw new Error(`Order ${bericht.order_id} heeft geen regels; TransusXML zou leeg zijn.`)
  }

  const orderbevInput = bericht.payload_parsed
  const recipientGln =
    orderRow.factuuradres_gln ??
    readPayloadString(orderbevInput, 'gln_gefactureerd') ??
    ''
  const buyerGln =
    orderRow.besteller_gln ??
    readPayloadString(orderbevInput, 'gln_besteller') ??
    ''
  const deliveryGln =
    orderRow.afleveradres_gln ??
    readPayloadString(orderbevInput, 'gln_afleveradres') ??
    ''
  assertRequiredFields([
    ['Invoicee/Recipient GLN', recipientGln],
    ['Buyer GLN', buyerGln],
    ['DeliveryParty GLN', deliveryGln],
  ])

  const orderdatum = orderRow.orderdatum ?? new Date().toISOString().slice(0, 10)
  const leverdatum =
    orderRow.afleverdatum ??
    readPayloadString(orderbevInput, 'leverdatum') ??
    new Date().toISOString().slice(0, 10)
  const debiteur = firstRelation(orderRow.debiteuren)
  // Intracommunautaire B2B-debiteuren krijgen 0% — BTW verlegd naar afnemer.
  // Bewezen voor BDSK 2026-04-30: origineel orderbev had `TAX+7+VAT+++:::0+S`.
  const vatPercentage = debiteur?.btw_verlegd_intracom
    ? 0
    : toNumber(debiteur?.btw_percentage, 0)
  const supplierOrderNumber = String(orderRow.order_nr ?? bericht.order_id)

  const articles: OrderbevXmlArticle[] = (regels as unknown as OrderRegelVoorXml[]).map((r) => {
    const product = firstRelation(r.producten)
    const prijs = toNumber(r.prijs, 0)
    return {
      lineNumber: String(r.regelnummer),
      articleDescription: r.omschrijving ?? '',
      articleCodeSupplier: r.artikelnr ?? '',
      gtin: product?.ean_code ?? '',
      purchasePrice: prijs,
      articleNetPrice: prijs,
      vatPercentage,
      action: 'ACC',
      orderedQuantity: toNumber(r.orderaantal, 1),
      despatchedQuantity: toNumber(r.te_leveren, toNumber(r.orderaantal, 1)),
      deliveryDate: leverdatum,
    }
  })
  for (const article of articles) {
    assertRequiredFields([
      [`regel ${article.lineNumber} artikelnr`, article.articleCodeSupplier],
      [`regel ${article.lineNumber} GTIN`, article.gtin],
    ])
  }

  const input: OrderbevXmlInput = {
    senderGln: karpiGln,
    recipientGln,
    isTestMessage: bericht.is_test,
    orderResponseNumber: buildOrderResponseNumber(supplierOrderNumber, seq),
    orderResponseDate: new Date().toISOString().slice(0, 10),
    action: 'ACC',
    orderNumberBuyer: orderRow.klant_referentie ?? '',
    orderNumberSupplier: supplierOrderNumber,
    orderDate: orderdatum,
    earliestDeliveryDate: leverdatum,
    latestDeliveryDate: leverdatum,
    currencyCode: 'EUR',
    buyerGln,
    supplierGln: karpiGln,
    invoiceeGln: recipientGln,
    deliveryPartyGln: deliveryGln,
    articles,
  }

  const xml = buildOrderbevTransusXml(input)
  const filenameBase = safeFilenamePart(orderRow.klant_referentie ?? orderRow.order_nr ?? String(bericht.order_id))
  const filename = `orderbev-${filenameBase}-${seq.toString().padStart(4, '0')}.xml`

  return { filename, xml, input, seq }
}

function assertRequiredFields(fields: Array<[label: string, value: string | null | undefined]>): void {
  const missing = fields
    .filter(([, value]) => !value || value.trim() === '')
    .map(([label]) => label)
  if (missing.length > 0) {
    throw new Error(`TransusXML niet te bouwen; verplichte velden ontbreken: ${missing.join(', ')}`)
  }
}

function readPayloadString(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function toNumber(value: number | string | null | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'order'
}

function triggerDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
