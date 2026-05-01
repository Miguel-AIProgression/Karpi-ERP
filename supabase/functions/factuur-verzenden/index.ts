// Supabase Edge Function: factuur-verzenden
// Drainst factuur_queue: genereert factuur (RPC), bouwt PDF, mailt met AV als bijlage.
// Zie plan: docs/superpowers/plans/2026-04-22-facturatie-module.md

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { genereerFactuurPDF } from '../_shared/factuur-pdf.ts'
import { sendFactuurEmail } from '../_shared/resend-client.ts'
import {
  buildKarpiInvoiceFixedWidth,
  type InvoiceParty,
  type KarpiInvoiceInput,
} from '../_shared/transus-formats/karpi-invoice-fixed-width.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const FACTUUR_FROM = Deno.env.get('FACTUUR_FROM_EMAIL')!
const FACTUUR_REPLY_TO = Deno.env.get('FACTUUR_REPLY_TO') ?? FACTUUR_FROM
const AV_PATH = Deno.env.get('ALGEMENE_VOORWAARDEN_PATH') ?? 'algemene-voorwaarden-karpi-bv.pdf'

const MAX_BATCH = 10
const MAX_ATTEMPTS = 3

interface QueueItem {
  id: number
  debiteur_nr: number
  order_ids: number[]
  type: 'per_zending' | 'wekelijks'
  attempts: number
}

interface EdiConfig {
  transus_actief: boolean
  factuur_uit: boolean
  test_modus: boolean
}

interface FactuurRow {
  id: number
  factuur_nr: string
  factuurdatum: string
  vervaldatum: string
  debiteur_nr: number
  fact_naam: string | null
  fact_adres: string | null
  fact_postcode: string | null
  fact_plaats: string | null
  fact_land: string | null
  btw_nummer: string | null
  subtotaal: number | string
  btw_percentage: number | string
  btw_bedrag: number | string
  totaal: number | string
}

interface FactuurRegelRow {
  id: number
  factuur_id: number
  order_id: number
  order_regel_id: number
  regelnummer: number
  artikelnr: string | null
  omschrijving: string | null
  omschrijving_2: string | null
  uw_referentie: string | null
  order_nr: string | null
  aantal: number | string
  prijs: number | string
  korting_pct: number | string
  bedrag: number | string
  btw_percentage: number | string
}

interface BedrijfConfig {
  bedrijfsnaam: string
  adres: string
  postcode: string
  plaats: string
  land: string
  telefoon: string
  email: string
  website: string
  kvk: string
  btw_nummer: string
  iban: string
  bic: string
  bank: string
  rekeningnummer: string
  betalingscondities_tekst: string
  fax?: string
  gln_eigen?: string
}

interface DebiteurFactuurRow {
  email_factuur: string | null
  naam: string | null
  vertegenw_code: string | null
  gln_bedrijf: string | null
  btw_nummer: string | null
  fact_naam: string | null
  fact_adres: string | null
  fact_postcode: string | null
  fact_plaats: string | null
  adres: string | null
  postcode: string | null
  plaats: string | null
  land: string | null
}

interface OrderForEdi {
  id: number
  order_nr: string | null
  oud_order_nr: number | string | null
  klant_referentie: string | null
  orderdatum: string | null
  fact_naam: string | null
  fact_adres: string | null
  fact_postcode: string | null
  fact_plaats: string | null
  fact_land: string | null
  bes_naam: string | null
  bes_adres: string | null
  bes_postcode: string | null
  bes_plaats: string | null
  bes_land: string | null
  afl_naam: string | null
  afl_naam_2: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_plaats: string | null
  afl_land: string | null
  factuuradres_gln: string | null
  besteller_gln: string | null
  afleveradres_gln: string | null
}

interface OrderRegelForEdi {
  id: number
  karpi_code: string | null
  gewicht_kg: number | string | null
}

interface ProductForEdi {
  artikelnr: string
  karpi_code: string | null
  omschrijving: string | null
  omschrijving_2: string | null
  ean_code: string | null
  gewicht_kg: number | string | null
}

interface KlantArtikelForEdi {
  artikelnr: string
  klant_artikel: string | null
  omschrijving: string | null
}

serve(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)

  const { data: items, error: fetchErr } = await supabase
    .from('factuur_queue')
    .select('id, debiteur_nr, order_ids, type, attempts')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(MAX_BATCH)

  if (fetchErr) {
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  const results: Array<{ id: number; status: string; error?: string; factuur_nr?: string; edi_bericht_id?: number | null }> = []

  for (const item of (items ?? []) as QueueItem[]) {
    let markedProcessing = false
    try {
      // 1. Markeer als processing (met timestamp voor recovery van stuck items)
      const { error: markErr } = await supabase
        .from('factuur_queue')
        .update({ status: 'processing', processing_started_at: new Date().toISOString() })
        .eq('id', item.id)
      if (markErr) throw new Error(`Mark processing: ${markErr.message}`)
      markedProcessing = true

      // 2. Genereer factuur via RPC (atomair)
      const { data: factuurIdData, error: rpcErr } = await supabase.rpc('genereer_factuur', {
        p_order_ids: item.order_ids,
      })
      if (rpcErr) throw new Error(`RPC genereer_factuur: ${rpcErr.message}`)
      const factuurId = factuurIdData as number
      if (!factuurId) throw new Error('genereer_factuur returned null')

      // 3. Laad factuur + regels + bedrijfsconfig + debiteur + vertegenwoordiger
      const [factuurRes, regelsRes, bedrijfRes, debiteurRes] = await Promise.all([
        supabase.from('facturen').select('*').eq('id', factuurId).single(),
        supabase.from('factuur_regels').select('*').eq('factuur_id', factuurId).order('regelnummer'),
        supabase.from('app_config').select('waarde').eq('sleutel', 'bedrijfsgegevens').single(),
        supabase
          .from('debiteuren')
          .select(
            'email_factuur, naam, vertegenw_code, gln_bedrijf, btw_nummer, ' +
              'fact_naam, fact_adres, fact_postcode, fact_plaats, adres, postcode, plaats, land',
          )
          .eq('debiteur_nr', item.debiteur_nr)
          .single(),
      ])
      if (factuurRes.error) throw new Error(`Fetch factuur: ${factuurRes.error.message}`)
      if (regelsRes.error) throw new Error(`Fetch regels: ${regelsRes.error.message}`)
      if (bedrijfRes.error) throw new Error(`Fetch bedrijfsgegevens: ${bedrijfRes.error.message}`)
      if (debiteurRes.error) throw new Error(`Fetch debiteur: ${debiteurRes.error.message}`)

      const factuur = factuurRes.data as FactuurRow
      const regels = (regelsRes.data ?? []) as FactuurRegelRow[]
      const bedrijf = bedrijfRes.data.waarde as BedrijfConfig
      const debiteur = debiteurRes.data as DebiteurFactuurRow
      const ediConfig = await fetchEdiConfig(supabase, item.debiteur_nr)
      const ediFactuurActief = !!(ediConfig?.transus_actief && ediConfig.factuur_uit)

      if (!debiteur.email_factuur && !ediFactuurActief) {
        throw new Error(`Debiteur ${item.debiteur_nr} heeft geen email_factuur`)
      }

      let vertegenwoordigerNaam = 'Niet van Toepassing'
      if (debiteur.vertegenw_code) {
        const { data: vert } = await supabase
          .from('vertegenwoordigers')
          .select('naam')
          .eq('code', debiteur.vertegenw_code)
          .maybeSingle()
        if (vert?.naam) vertegenwoordigerNaam = vert.naam
      }

      // 4. Bouw PDF
      const pdfBytes = await genereerFactuurPDF({
        bedrijf: {
          bedrijfsnaam: bedrijf.bedrijfsnaam,
          adres: bedrijf.adres,
          postcode: bedrijf.postcode,
          plaats: bedrijf.plaats,
          land: bedrijf.land,
          telefoon: bedrijf.telefoon,
          email: bedrijf.email,
          website: bedrijf.website,
          kvk: bedrijf.kvk,
          btw_nummer: bedrijf.btw_nummer,
          iban: bedrijf.iban,
          bic: bedrijf.bic,
          bank: bedrijf.bank,
          rekeningnummer: bedrijf.rekeningnummer,
          betalingscondities_tekst: bedrijf.betalingscondities_tekst,
          fax: bedrijf.fax,
        },
        factuur: {
          factuur_nr: factuur.factuur_nr,
          factuurdatum: factuur.factuurdatum,
          debiteur_nr: factuur.debiteur_nr,
          vertegenwoordiger: vertegenwoordigerNaam,
          fact_naam: factuur.fact_naam ?? '',
          fact_adres: factuur.fact_adres ?? '',
          fact_postcode: factuur.fact_postcode ?? '',
          fact_plaats: factuur.fact_plaats ?? '',
          subtotaal: Number(factuur.subtotaal),
          btw_percentage: Number(factuur.btw_percentage),
          btw_bedrag: Number(factuur.btw_bedrag),
          totaal: Number(factuur.totaal),
        },
        regels: regels.map((r) => ({
          order_nr: r.order_nr ?? '',
          uw_referentie: r.uw_referentie ?? '',
          artikelnr: r.artikelnr ?? '',
          aantal: Number(r.aantal),
          eenheid: 'St',
          omschrijving: r.omschrijving ?? '',
          omschrijving_2: r.omschrijving_2 ?? undefined,
          prijs: Number(r.prijs),
          bedrag: Number(r.bedrag),
        })),
      })

      // 5. Upload PDF naar storage
      const pdfPath = `${item.debiteur_nr}/${factuur.factuur_nr}.pdf`
      const { error: uploadErr } = await supabase.storage
        .from('facturen')
        .upload(pdfPath, pdfBytes, {
          contentType: 'application/pdf',
          upsert: true,
        })
      if (uploadErr) throw new Error(`Upload PDF: ${uploadErr.message}`)

      // 6. Queue EDI INVOIC indien voor deze handelspartner actief.
      let ediBerichtId: number | null = null
      if (ediFactuurActief && ediConfig) {
        ediBerichtId = await queueEdiFactuur(
          supabase,
          factuur,
          regels,
          bedrijf,
          debiteur,
          ediConfig,
        )
      }

      // 7. Verstuur email met factuur-PDF + AV als bijlage, indien ingesteld.
      if (debiteur.email_factuur) {
        const { data: avBlob, error: avErr } = await supabase.storage
          .from('documenten')
          .download(AV_PATH)
        if (avErr || !avBlob) throw new Error(`Download AV: ${avErr?.message ?? 'geen data'}`)
        const avBytes = new Uint8Array(await avBlob.arrayBuffer())

        const emailHtml = `
<p>Geachte heer/mevrouw,</p>
<p>Hierbij ontvangt u bijgaand factuur <strong>${factuur.factuur_nr}</strong>.</p>
<p>Onze algemene voorwaarden vindt u als bijlage bij deze e-mail.</p>
<p>Met vriendelijke groet,<br/>KARPI BV</p>
      `.trim()

        await sendFactuurEmail({
          apiKey: RESEND_API_KEY,
          from: FACTUUR_FROM,
          to: debiteur.email_factuur,
          replyTo: FACTUUR_REPLY_TO,
          subject: `Factuur ${factuur.factuur_nr}`,
          html: emailHtml,
          attachments: [
            { filename: `${factuur.factuur_nr}.pdf`, content: pdfBytes },
            { filename: 'Algemene voorwaarden KARPI BV.pdf', content: avBytes },
          ],
        })
      }

      // 8. Factuur + queue finalisatie
      const nowIso = new Date().toISOString()
      await supabase
        .from('facturen')
        .update({
          status: 'Verstuurd',
          verstuurd_op: nowIso,
          verstuurd_naar: debiteur.email_factuur ?? (ediBerichtId ? 'EDI Transus' : null),
          pdf_storage_path: pdfPath,
        })
        .eq('id', factuurId)

      await supabase
        .from('factuur_queue')
        .update({
          status: 'done',
          factuur_id: factuurId,
          processed_at: nowIso,
          processing_started_at: null,
        })
        .eq('id', item.id)

      results.push({ id: item.id, status: 'done', factuur_nr: factuur.factuur_nr, edi_bericht_id: ediBerichtId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const nextAttempts = item.attempts + 1
      const nextStatus = nextAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending'

      // Als we de processing-markering hebben gezet, moeten we de status terugzetten.
      // Zo niet (mark-fout zelf), dan staat het item al op pending — geen DB-update nodig.
      if (markedProcessing) {
        await supabase
          .from('factuur_queue')
          .update({
            status: nextStatus,
            attempts: nextAttempts,
            last_error: msg,
            processing_started_at: null,
          })
          .eq('id', item.id)
      }
      results.push({ id: item.id, status: nextStatus, error: msg })
    }
  }

  return new Response(
    JSON.stringify({ processed: results.length, results }),
    { headers: { 'content-type': 'application/json' } },
  )
})

async function fetchEdiConfig(
  supabase: ReturnType<typeof createClient>,
  debiteurNr: number,
): Promise<EdiConfig | null> {
  const { data, error } = await supabase
    .from('edi_handelspartner_config')
    .select('transus_actief, factuur_uit, test_modus')
    .eq('debiteur_nr', debiteurNr)
    .maybeSingle()
  if (error) throw new Error(`Fetch EDI-config: ${error.message}`)
  return data as EdiConfig | null
}

async function queueEdiFactuur(
  supabase: ReturnType<typeof createClient>,
  factuur: FactuurRow,
  regels: FactuurRegelRow[],
  bedrijf: BedrijfConfig,
  debiteur: DebiteurFactuurRow,
  ediConfig: EdiConfig,
): Promise<number> {
  const { data: bestaand, error: bestaandErr } = await supabase
    .from('edi_berichten')
    .select('id')
    .eq('richting', 'uit')
    .eq('berichttype', 'factuur')
    .eq('bron_tabel', 'facturen')
    .eq('bron_id', factuur.id)
    .not('status', 'in', '("Fout","Geannuleerd")')
    .maybeSingle()
  if (bestaandErr) throw new Error(`Fetch bestaande EDI-factuur: ${bestaandErr.message}`)
  if (bestaand?.id) return bestaand.id as number

  const input = await buildEdiFactuurInput(supabase, factuur, regels, bedrijf, debiteur, ediConfig)
  const payloadRaw = buildKarpiInvoiceFixedWidth(input)
  const firstOrderId = regels.map((r) => Number(r.order_id)).find((id) => Number.isFinite(id)) ?? null

  const { data, error } = await supabase
    .from('edi_berichten')
    .insert({
      richting: 'uit',
      berichttype: 'factuur',
      status: 'Wachtrij',
      debiteur_nr: factuur.debiteur_nr,
      order_id: firstOrderId,
      factuur_id: factuur.id,
      bron_tabel: 'facturen',
      bron_id: factuur.id,
      payload_raw: payloadRaw,
      payload_parsed: {
        format: 'karpi_fixed_width_invoice',
        source: input,
      },
      is_test: ediConfig.test_modus,
    })
    .select('id')
    .single()
  if (error) throw new Error(`Queue EDI-factuur: ${error.message}`)
  return data.id as number
}

async function buildEdiFactuurInput(
  supabase: ReturnType<typeof createClient>,
  factuur: FactuurRow,
  regels: FactuurRegelRow[],
  bedrijf: BedrijfConfig,
  debiteur: DebiteurFactuurRow,
  ediConfig: EdiConfig,
): Promise<KarpiInvoiceInput> {
  if (regels.length === 0) {
    throw new Error(`Factuur ${factuur.factuur_nr} heeft geen regels; EDI INVOIC niet te bouwen`)
  }

  const orderIds = uniqueNumbers(regels.map((r) => Number(r.order_id)))
  const regelIds = uniqueNumbers(regels.map((r) => Number(r.order_regel_id)))
  const artikelnrs = uniqueStrings(regels.map((r) => r.artikelnr))

  const [orders, orderRegels, producten, klantArtikelen] = await Promise.all([
    fetchOrdersForEdi(supabase, orderIds),
    fetchOrderRegelsForEdi(supabase, regelIds),
    fetchProductenForEdi(supabase, artikelnrs),
    fetchKlantArtikelenForEdi(supabase, factuur.debiteur_nr, artikelnrs),
  ])

  const firstOrder = orders[0]
  if (!firstOrder) {
    throw new Error(`Factuur ${factuur.factuur_nr}: geen gekoppelde orders gevonden voor EDI INVOIC`)
  }

  const ordersById = new Map(orders.map((o) => [Number(o.id), o]))
  const orderRegelsById = new Map(orderRegels.map((r) => [Number(r.id), r]))
  const productenByArtikel = new Map(producten.map((p) => [p.artikelnr, p]))
  const klantArtikelByArtikel = new Map(klantArtikelen.map((k) => [k.artikelnr, k]))

  const invoiceeGln = firstNonEmpty(firstOrder.factuuradres_gln, debiteur.gln_bedrijf)
  const buyerGln = firstNonEmpty(firstOrder.besteller_gln, firstOrder.afleveradres_gln, invoiceeGln)
  const deliveryGln = firstNonEmpty(firstOrder.afleveradres_gln, buyerGln)
  if (!invoiceeGln || !buyerGln || !deliveryGln) {
    throw new Error(
      `Factuur ${factuur.factuur_nr}: GLN ontbreekt (IV=${invoiceeGln ?? '-'}, BY=${buyerGln ?? '-'}, DP=${deliveryGln ?? '-'})`,
    )
  }

  const supplier = buildSupplierParty(bedrijf)
  const invoicee = buildInvoiceeParty(factuur, debiteur, invoiceeGln)
  const deliveryParty = buildDeliveryParty(firstOrder, invoicee, deliveryGln)
  const buyer = buildBuyerParty(firstOrder, invoicee, deliveryParty, buyerGln)
  const orderNumberBuyer = firstNonEmpty(
    regels.find((r) => r.uw_referentie)?.uw_referentie,
    firstOrder.klant_referentie,
    factuur.factuur_nr,
  )!
  const supplierOrderNumber = firstNonEmpty(
    firstOrder.oud_order_nr == null ? null : String(firstOrder.oud_order_nr),
    firstOrder.order_nr,
    factuur.factuur_nr,
  )!
  const deliveryNoteNumber = factuur.factuur_nr

  return {
    invoiceDate: factuur.factuurdatum,
    invoiceNumber: factuur.factuur_nr,
    customerShortName: debiteur.naam ?? null,
    recipientGln: invoiceeGln,
    orderNumberBuyer,
    orderDate: firstOrder.orderdatum ?? factuur.factuurdatum,
    deliveryNoteNumber,
    supplierOrderNumber,
    vatAmount: toNumber(factuur.btw_bedrag, 0),
    isTestMessage: ediConfig.test_modus,
    supplier,
    buyer,
    invoicee,
    deliveryParty,
    lines: regels.map((regel) => {
      const product = regel.artikelnr ? productenByArtikel.get(regel.artikelnr) : null
      const orderRegel = orderRegelsById.get(Number(regel.order_regel_id))
      const klantArtikel = regel.artikelnr ? klantArtikelByArtikel.get(regel.artikelnr) : null
      const regelOrder = ordersById.get(Number(regel.order_id)) ?? firstOrder
      const aantal = toNumber(regel.aantal, 0)
      const artikelCode = firstNonEmpty(orderRegel?.karpi_code, product?.karpi_code, regel.artikelnr)
      const omschrijving = firstNonEmpty(klantArtikel?.omschrijving, regel.omschrijving, product?.omschrijving, regel.omschrijving_2)
      const gewichtPerRegel = toNumber(orderRegel?.gewicht_kg, NaN)
      const gewichtProduct = toNumber(product?.gewicht_kg, 0) * aantal

      return {
        lineNumber: Number(regel.regelnummer),
        supplierArticleNumber: regel.artikelnr ?? '',
        articleDescription: [artikelCode, omschrijving].filter(Boolean).join(' '),
        deliveryNoteNumber,
        gtin: product?.ean_code ?? '',
        quantity: aantal,
        invoiceNumber: factuur.factuur_nr,
        netPrice: toNumber(regel.prijs, 0),
        orderNumberBuyer: firstNonEmpty(regel.uw_referentie, regelOrder.klant_referentie, orderNumberBuyer),
        buyerArticleNumber: klantArtikel?.klant_artikel ?? '',
        lineAmount: toNumber(regel.bedrag, 0),
        taxableAmount: toNumber(regel.bedrag, 0),
        vatAmount: Math.round(toNumber(regel.bedrag, 0) * toNumber(regel.btw_percentage, 0)) / 100,
        packageQuantity: aantal,
        weightKg: Number.isFinite(gewichtPerRegel) ? gewichtPerRegel : gewichtProduct,
        vatPercentage: toNumber(regel.btw_percentage, 0),
      }
    }),
  }
}

async function fetchOrdersForEdi(
  supabase: ReturnType<typeof createClient>,
  orderIds: number[],
): Promise<OrderForEdi[]> {
  if (orderIds.length === 0) return []
  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, order_nr, oud_order_nr, klant_referentie, orderdatum, ' +
        'fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, ' +
        'bes_naam, bes_adres, bes_postcode, bes_plaats, bes_land, ' +
        'afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land, ' +
        'factuuradres_gln, besteller_gln, afleveradres_gln',
    )
    .in('id', orderIds)
    .order('id', { ascending: true })
  if (error) throw new Error(`Fetch EDI-orders: ${error.message}`)
  return (data ?? []) as OrderForEdi[]
}

async function fetchOrderRegelsForEdi(
  supabase: ReturnType<typeof createClient>,
  regelIds: number[],
): Promise<OrderRegelForEdi[]> {
  if (regelIds.length === 0) return []
  const { data, error } = await supabase
    .from('order_regels')
    .select('id, karpi_code, gewicht_kg')
    .in('id', regelIds)
  if (error) throw new Error(`Fetch EDI-orderregels: ${error.message}`)
  return (data ?? []) as OrderRegelForEdi[]
}

async function fetchProductenForEdi(
  supabase: ReturnType<typeof createClient>,
  artikelnrs: string[],
): Promise<ProductForEdi[]> {
  if (artikelnrs.length === 0) return []
  const { data, error } = await supabase
    .from('producten')
    .select('artikelnr, karpi_code, omschrijving, omschrijving_2, ean_code, gewicht_kg')
    .in('artikelnr', artikelnrs)
  if (error) throw new Error(`Fetch EDI-producten: ${error.message}`)
  return (data ?? []) as ProductForEdi[]
}

async function fetchKlantArtikelenForEdi(
  supabase: ReturnType<typeof createClient>,
  debiteurNr: number,
  artikelnrs: string[],
): Promise<KlantArtikelForEdi[]> {
  if (artikelnrs.length === 0) return []
  const { data, error } = await supabase
    .from('klant_artikelnummers')
    .select('artikelnr, klant_artikel, omschrijving')
    .eq('debiteur_nr', debiteurNr)
    .in('artikelnr', artikelnrs)
  if (error) throw new Error(`Fetch EDI-klantartikelen: ${error.message}`)
  return (data ?? []) as KlantArtikelForEdi[]
}

function buildSupplierParty(bedrijf: BedrijfConfig): InvoiceParty {
  return {
    name: bedrijf.bedrijfsnaam ?? 'KARPI GROUP HOME FASHION B.V.',
    gln: bedrijf.gln_eigen ?? '8715954999998',
    address: bedrijf.adres ?? 'TWEEDE BROEKDIJK 10',
    postcode: bedrijf.postcode ?? '7122 LB',
    city: bedrijf.plaats ?? 'AALTEN',
    country: normalizeCountry(bedrijf.land, 'NL'),
    vatNumber: bedrijf.btw_nummer ?? null,
  }
}

function buildInvoiceeParty(
  factuur: FactuurRow,
  debiteur: DebiteurFactuurRow,
  gln: string,
): InvoiceParty {
  return {
    name: firstNonEmpty(factuur.fact_naam, debiteur.fact_naam, debiteur.naam, 'Onbekend')!,
    gln,
    address: firstNonEmpty(factuur.fact_adres, debiteur.fact_adres, debiteur.adres, '-')!,
    postcode: firstNonEmpty(factuur.fact_postcode, debiteur.fact_postcode, debiteur.postcode, '-')!,
    city: firstNonEmpty(factuur.fact_plaats, debiteur.fact_plaats, debiteur.plaats, '-')!,
    country: normalizeCountry(firstNonEmpty(factuur.fact_land, debiteur.land), 'NL'),
    vatNumber: firstNonEmpty(factuur.btw_nummer, debiteur.btw_nummer),
  }
}

function buildDeliveryParty(order: OrderForEdi, fallback: InvoiceParty, gln: string): InvoiceParty {
  return {
    name: firstNonEmpty(order.afl_naam, fallback.name)!,
    name2: order.afl_naam_2,
    gln,
    address: firstNonEmpty(order.afl_adres, fallback.address)!,
    postcode: firstNonEmpty(order.afl_postcode, fallback.postcode)!,
    city: firstNonEmpty(order.afl_plaats, fallback.city)!,
    country: normalizeCountry(firstNonEmpty(order.afl_land, fallback.country), fallback.country),
    vatNumber: fallback.vatNumber,
  }
}

function buildBuyerParty(
  order: OrderForEdi,
  invoicee: InvoiceParty,
  deliveryParty: InvoiceParty,
  gln: string,
): InvoiceParty {
  const addressSource = gln === deliveryParty.gln ? deliveryParty : invoicee
  return {
    name: firstNonEmpty(order.bes_naam, addressSource.name)!,
    gln,
    address: firstNonEmpty(order.bes_adres, addressSource.address)!,
    postcode: firstNonEmpty(order.bes_postcode, addressSource.postcode)!,
    city: firstNonEmpty(order.bes_plaats, addressSource.city)!,
    country: normalizeCountry(firstNonEmpty(order.bes_land, addressSource.country), addressSource.country),
    vatNumber: invoicee.vatNumber,
  }
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter((v) => Number.isFinite(v) && v > 0)))
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v && v.trim() !== '')))
}

function firstNonEmpty(...values: Array<string | number | null | undefined>): string | null {
  for (const value of values) {
    if (value == null) continue
    const s = String(value).trim()
    if (s !== '') return s
  }
  return null
}

function normalizeCountry(value: string | null | undefined, fallback: string): string {
  const country = (value ?? fallback).trim().toUpperCase()
  if (country === 'NEDERLAND') return 'NL'
  if (country === 'DUITSLAND' || country === 'GERMANY') return 'DE'
  return (country || fallback).slice(0, 2)
}

function toNumber(value: number | string | null | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}
