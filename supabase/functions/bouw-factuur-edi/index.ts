// Supabase Edge Function: bouw-factuur-edi
//
// Zet een (per-order) factuur op de uitgaande EDI-wachtrij. Haalt de factuur +
// order-partijen + GTIN's op, bouwt het Karpi fixed-width INVOIC-bericht via de
// gedeelde builder en doet een idempotente insert in `edi_berichten`
// (richting='uit', berichttype='factuur'). De cron `transus-send` pakt het op
// en verstuurt via Transus M10100 — die laag blijft dom (stuurt payload_raw).
//
// Scope V1: alleen facturen die precies 1 order dekken (per_zending).
// Plan: docs/superpowers/plans/2026-06-03-edi-factuur-uitgaand.md

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildKarpiInvoiceFixedWidth } from '../_shared/transus-formats/karpi-invoice-fixed-width.ts'
import {
  mapFactuurNaarInvoiceInput,
  type FactuurEdiData,
  type FactuurEdiPartij,
} from '../_shared/transus-formats/factuur-mapper.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

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

    const [factuurRes, regelsRes, bedrijfRes] = await Promise.all([
      sb.from('facturen').select('*').eq('id', factuurId).maybeSingle(),
      sb
        .from('factuur_regels')
        .select('regelnummer, artikelnr, omschrijving, aantal, prijs, bedrag, btw_percentage, order_id')
        .eq('factuur_id', factuurId)
        .order('regelnummer'),
      sb.from('app_config').select('waarde').eq('sleutel', 'bedrijfsgegevens').maybeSingle(),
    ])

    if (factuurRes.error) return json(500, { error: `Fetch factuur: ${factuurRes.error.message}` })
    if (!factuurRes.data) return json(404, { error: `Factuur ${factuurId} niet gevonden` })
    if (regelsRes.error) return json(500, { error: `Fetch regels: ${regelsRes.error.message}` })
    if (bedrijfRes.error) return json(500, { error: `Fetch bedrijfsgegevens: ${bedrijfRes.error.message}` })
    if (!bedrijfRes.data?.waarde) return json(500, { error: 'Bedrijfsgegevens ontbreken (app_config)' })

    const factuur = factuurRes.data as FactuurRow
    const regels = (regelsRes.data ?? []) as FactuurRegelRow[]
    const bedrijf = bedrijfRes.data.waarde as BedrijfConfig

    if (regels.length === 0) return json(422, { error: `Factuur ${factuur.factuur_nr} heeft geen regels` })

    // Scope V1: precies één order.
    const orderIds = Array.from(
      new Set(regels.map((r) => r.order_id).filter((v): v is number => v != null)),
    )
    if (orderIds.length !== 1) {
      return json(422, {
        error:
          `Factuur ${factuur.factuur_nr} dekt ${orderIds.length} orders. EDI-factuur ondersteunt in ` +
          `V1 alleen per-order facturen (1 order). Multi-order/weekly volgt later.`,
      })
    }
    const orderId = orderIds[0]

    const [orderRes, debiteurRes, configRes] = await Promise.all([
      sb
        .from('orders')
        .select(
          'order_nr, orderdatum, klant_referentie, ' +
            'bes_naam, bes_adres, bes_postcode, bes_plaats, bes_land, besteller_gln, ' +
            'fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, factuuradres_gln, ' +
            'afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land, afleveradres_gln',
        )
        .eq('id', orderId)
        .maybeSingle(),
      sb
        .from('debiteuren')
        .select('naam, btw_nummer, btw_verlegd_intracom')
        .eq('debiteur_nr', factuur.debiteur_nr)
        .maybeSingle(),
      sb
        .from('edi_handelspartner_config')
        .select('factuur_uit, transus_actief, test_modus')
        .eq('debiteur_nr', factuur.debiteur_nr)
        .maybeSingle(),
    ])

    if (orderRes.error) return json(500, { error: `Fetch order: ${orderRes.error.message}` })
    if (!orderRes.data) return json(404, { error: `Order ${orderId} niet gevonden` })
    if (debiteurRes.error) return json(500, { error: `Fetch debiteur: ${debiteurRes.error.message}` })
    if (!debiteurRes.data) return json(404, { error: `Debiteur ${factuur.debiteur_nr} niet gevonden` })
    if (configRes.error) return json(500, { error: `Fetch config: ${configRes.error.message}` })

    const cfg = configRes.data as ConfigRow | null
    if (!cfg?.transus_actief || !cfg?.factuur_uit) {
      return json(422, {
        error:
          `Debiteur ${factuur.debiteur_nr} heeft factuur-EDI niet aan ` +
          `(factuur_uit=${cfg?.factuur_uit ?? false}, transus_actief=${cfg?.transus_actief ?? false}).`,
      })
    }

    const order = orderRes.data as unknown as OrderRow
    const debiteur = debiteurRes.data as DebiteurRow

    // GTIN's: producten.ean_code op artikelnr.
    const artikelnrs = Array.from(
      new Set(regels.map((r) => r.artikelnr).filter((v): v is string => !!v)),
    )
    const productenRes = artikelnrs.length
      ? await sb.from('producten').select('artikelnr, ean_code').in('artikelnr', artikelnrs)
      : { data: [] as ProductRow[], error: null }
    if (productenRes.error) return json(500, { error: `Fetch producten: ${productenRes.error.message}` })
    const eanByArtikel = new Map<string, string | null>()
    for (const p of (productenRes.data ?? []) as ProductRow[]) {
      eanByArtikel.set(p.artikelnr, p.ean_code)
    }

    // deliveryNoteNumber: zending-nr van de order, anders factuur_nr.
    const deliveryNoteNumber = (await zendingNrVoorOrder(sb, orderId)) ?? factuur.factuur_nr

    const data: FactuurEdiData = {
      factuur: {
        factuur_nr: factuur.factuur_nr,
        factuurdatum: factuur.factuurdatum,
        btw_bedrag: Number(factuur.btw_bedrag),
      },
      order: {
        order_nr: order.order_nr,
        orderdatum: order.orderdatum,
        klant_referentie: order.klant_referentie,
        btw_nummer: factuur.btw_nummer, // factuur-snapshot
        besteller: partij(order, 'bes', order.besteller_gln),
        factuuradres: partij(order, 'fact', order.factuuradres_gln),
        afleveradres: partij(order, 'afl', order.afleveradres_gln),
      },
      supplier: {
        name: bedrijf.bedrijfsnaam,
        gln: bedrijf.gln_eigen ?? '8715954999998',
        address: bedrijf.adres,
        postcode: bedrijf.postcode,
        city: bedrijf.plaats,
        country: bedrijf.land,
        vatNumber: bedrijf.btw_nummer ?? null,
      },
      debiteur: {
        naam: debiteur.naam,
        btw_nummer: debiteur.btw_nummer,
        btw_verlegd_intracom: debiteur.btw_verlegd_intracom ?? false,
      },
      deliveryNoteNumber,
      isTestMessage: cfg.test_modus ?? false,
      regels: regels.map((r) => ({
        regelnummer: r.regelnummer,
        artikelnr: r.artikelnr,
        omschrijving: r.omschrijving,
        aantal: Number(r.aantal),
        prijs: Number(r.prijs),
        bedrag: Number(r.bedrag),
        btw_percentage: Number(r.btw_percentage),
        gtin: (r.artikelnr ? eanByArtikel.get(r.artikelnr) : null) ?? null,
      })),
    }

    // Mapper gooit bij ontbrekende GTIN — net die 422 doorgeven aan de UI.
    let payloadRaw: string
    try {
      payloadRaw = buildKarpiInvoiceFixedWidth(mapFactuurNaarInvoiceInput(data))
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
        debiteur_nr: factuur.debiteur_nr,
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

function partij(order: OrderRow, prefix: 'bes' | 'fact' | 'afl', gln: string | null): FactuurEdiPartij {
  const o = order as unknown as Record<string, string | null>
  return {
    naam: o[`${prefix}_naam`],
    adres: o[`${prefix}_adres`],
    postcode: o[`${prefix}_postcode`],
    plaats: o[`${prefix}_plaats`],
    land: o[`${prefix}_land`],
    gln,
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}

interface FactuurRow {
  id: number
  factuur_nr: string
  factuurdatum: string
  debiteur_nr: number
  btw_bedrag: number | string
  btw_nummer: string | null
}
interface FactuurRegelRow {
  regelnummer: number
  artikelnr: string | null
  omschrijving: string | null
  aantal: number | string
  prijs: number | string
  bedrag: number | string
  btw_percentage: number | string
  order_id: number | null
}
interface OrderRow {
  order_nr: string
  orderdatum: string
  klant_referentie: string | null
  besteller_gln: string | null
  factuuradres_gln: string | null
  afleveradres_gln: string | null
}
interface DebiteurRow {
  naam: string
  btw_nummer: string | null
  btw_verlegd_intracom: boolean | null
}
interface ConfigRow {
  factuur_uit: boolean
  transus_actief: boolean
  test_modus: boolean | null
}
interface ProductRow {
  artikelnr: string
  ean_code: string | null
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
