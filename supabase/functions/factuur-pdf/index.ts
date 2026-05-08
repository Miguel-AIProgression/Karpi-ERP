// Supabase Edge Function: factuur-pdf
// Rendert een factuur real-time als PDF en streamt de bytes terug.
// Geen DB-mutaties, geen mail, geen EDI — pure preview/download voor de UI.
// Werkt op elke factuur, ongeacht status (Concept ook).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { genereerFactuurPDF } from '../_shared/factuur-pdf.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface FactuurRow {
  id: number
  factuur_nr: string
  factuurdatum: string
  debiteur_nr: number
  fact_naam: string | null
  fact_adres: string | null
  fact_postcode: string | null
  fact_plaats: string | null
  subtotaal: number | string
  btw_percentage: number | string
  btw_bedrag: number | string
  totaal: number | string
}

interface FactuurRegelRow {
  artikelnr: string | null
  omschrijving: string | null
  omschrijving_2: string | null
  uw_referentie: string | null
  order_nr: string | null
  order_id: number | null
  order_regel_id: number | null
  aantal: number | string
  prijs: number | string
  bedrag: number | string
}

interface OrderRegelMeta {
  id: number
  gewicht_kg: number | string | null
  maatwerk_oppervlak_m2: number | string | null
}

interface OrderMeta {
  id: number
  afl_naam: string | null
  afl_naam_2: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_plaats: string | null
}

interface ProductMeta {
  artikelnr: string
  lengte_cm: number | null
  breedte_cm: number | null
  vorm: string | null
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
  bank2?: {
    bank: string
    rekeningnummer: string
    bic: string
    iban: string
    blz?: string
  }
  voorwaarden_nl?: string
  voorwaarden_de?: string
  voorwaarden_en?: string
  // Optionele storage-pad naar het logo (bv. "branding/karpi-logo.jpg" in bucket 'public-assets').
  // Default als veld ontbreekt: 'public-assets' bucket + 'karpi-logo.jpg'.
  logo_storage_bucket?: string
  logo_storage_pad?: string
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  try {
    const url = new URL(req.url)
    let factuurId = Number(url.searchParams.get('factuur_id') ?? '')
    if (!Number.isFinite(factuurId) || factuurId <= 0) {
      try {
        const body = await req.json()
        factuurId = Number(body?.factuur_id ?? 0)
      } catch {
        // body niet aanwezig of geen JSON — laat factuurId staan
      }
    }
    if (!Number.isFinite(factuurId) || factuurId <= 0) {
      return jsonError(400, 'factuur_id ontbreekt of is ongeldig')
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)

    const [factuurRes, regelsRes, bedrijfRes] = await Promise.all([
      supabase.from('facturen').select('*').eq('id', factuurId).maybeSingle(),
      supabase
        .from('factuur_regels')
        .select(
          'artikelnr, omschrijving, omschrijving_2, uw_referentie, order_nr, order_id, order_regel_id, aantal, prijs, bedrag',
        )
        .eq('factuur_id', factuurId)
        .order('regelnummer'),
      supabase.from('app_config').select('waarde').eq('sleutel', 'bedrijfsgegevens').maybeSingle(),
    ])

    if (factuurRes.error) return jsonError(500, `Fetch factuur: ${factuurRes.error.message}`)
    if (!factuurRes.data) return jsonError(404, `Factuur ${factuurId} niet gevonden`)
    if (regelsRes.error) return jsonError(500, `Fetch regels: ${regelsRes.error.message}`)
    if (bedrijfRes.error) return jsonError(500, `Fetch bedrijfsgegevens: ${bedrijfRes.error.message}`)
    if (!bedrijfRes.data?.waarde) {
      return jsonError(
        500,
        'Bedrijfsgegevens ontbreken — vul ze in via /instellingen/bedrijfsgegevens (app_config sleutel "bedrijfsgegevens")',
      )
    }

    const factuur = factuurRes.data as FactuurRow
    const regels = (regelsRes.data ?? []) as FactuurRegelRow[]
    const bedrijf = bedrijfRes.data.waarde as BedrijfConfig

    // Verzamel ID's voor secundaire fetches (m2, gewicht, afleveradres)
    const orderIds = Array.from(new Set(regels.map((r) => r.order_id).filter((v): v is number => v !== null)))
    const orderRegelIds = Array.from(
      new Set(regels.map((r) => r.order_regel_id).filter((v): v is number => v !== null)),
    )
    const artikelnrs = Array.from(
      new Set(regels.map((r) => r.artikelnr).filter((v): v is string => v !== null && v.length > 0)),
    )

    const [ordersRes, orderRegelsRes, productenRes] = await Promise.all([
      orderIds.length > 0
        ? supabase
            .from('orders')
            .select('id, afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats')
            .in('id', orderIds)
        : Promise.resolve({ data: [] as OrderMeta[], error: null }),
      orderRegelIds.length > 0
        ? supabase
            .from('order_regels')
            .select('id, gewicht_kg, maatwerk_oppervlak_m2')
            .in('id', orderRegelIds)
        : Promise.resolve({ data: [] as OrderRegelMeta[], error: null }),
      artikelnrs.length > 0
        ? supabase
            .from('producten')
            .select('artikelnr, lengte_cm, breedte_cm, vorm')
            .in('artikelnr', artikelnrs)
        : Promise.resolve({ data: [] as ProductMeta[], error: null }),
    ])

    if (ordersRes.error) return jsonError(500, `Fetch orders: ${ordersRes.error.message}`)
    if (orderRegelsRes.error) return jsonError(500, `Fetch order_regels: ${orderRegelsRes.error.message}`)
    if (productenRes.error) return jsonError(500, `Fetch producten: ${productenRes.error.message}`)

    const ordersById = new Map<number, OrderMeta>()
    for (const o of (ordersRes.data ?? []) as OrderMeta[]) ordersById.set(o.id, o)

    const orderRegelsById = new Map<number, OrderRegelMeta>()
    for (const orr of (orderRegelsRes.data ?? []) as OrderRegelMeta[]) orderRegelsById.set(orr.id, orr)

    const productenByArtikelnr = new Map<string, ProductMeta>()
    for (const p of (productenRes.data ?? []) as ProductMeta[]) productenByArtikelnr.set(p.artikelnr, p)

    // Logo ophalen uit Storage (best effort — als bucket/pad niet bestaat: skip)
    const logoBucket = bedrijf.logo_storage_bucket ?? 'public-assets'
    const logoPad = bedrijf.logo_storage_pad ?? 'karpi-logo.jpg'
    let logoOptie: { bytes: Uint8Array; format: 'jpg' | 'png'; hoogte_mm: number } | undefined
    try {
      const dl = await supabase.storage.from(logoBucket).download(logoPad)
      if (dl.data) {
        const bytes = new Uint8Array(await dl.data.arrayBuffer())
        const format: 'jpg' | 'png' = logoPad.toLowerCase().endsWith('.png') ? 'png' : 'jpg'
        logoOptie = { bytes, format, hoogte_mm: 18 }
      }
    } catch {
      // Logo niet beschikbaar — PDF wordt zonder logo gerenderd (oude gedrag).
    }

    let vertegenwoordigerNaam = 'Niet van Toepassing'
    const { data: debiteur } = await supabase
      .from('debiteuren')
      .select('vertegenw_code')
      .eq('debiteur_nr', factuur.debiteur_nr)
      .maybeSingle()
    if (debiteur?.vertegenw_code) {
      const { data: vert } = await supabase
        .from('vertegenwoordigers')
        .select('naam')
        .eq('code', debiteur.vertegenw_code)
        .maybeSingle()
      if (vert?.naam) vertegenwoordigerNaam = vert.naam
    }

    // M2 + gewicht per regel berekenen
    const factAdres = (factuur.fact_adres ?? '').trim().toLowerCase()
    const factPostcode = (factuur.fact_postcode ?? '').trim().toLowerCase()
    let totaalM2 = 0
    let totaalGewichtKg = 0

    // Per order: alleen op eerste factuurregel van die order toon de afleveradres-snapshot,
    // en alleen als die afwijkt van het factuuradres.
    const aflGetoondPerOrder = new Set<number>()

    const renderRegels = regels.map((r) => {
      const orderRegel = r.order_regel_id !== null ? orderRegelsById.get(r.order_regel_id) : undefined
      const product = r.artikelnr ? productenByArtikelnr.get(r.artikelnr) : undefined
      const aantal = Number(r.aantal)

      // m2-berekening per regel (per stuk × aantal)
      let m2PerStuk = 0
      const maatwerkM2 = orderRegel?.maatwerk_oppervlak_m2
      if (maatwerkM2 !== null && maatwerkM2 !== undefined && Number(maatwerkM2) > 0) {
        m2PerStuk = Number(maatwerkM2)
      } else if (product?.lengte_cm && product?.breedte_cm) {
        if (product.vorm === 'rond') {
          m2PerStuk = Math.PI * Math.pow(product.lengte_cm / 200, 2)
        } else {
          m2PerStuk = (product.lengte_cm * product.breedte_cm) / 10000
        }
      }
      totaalM2 += m2PerStuk * aantal

      // gewicht: order_regels.gewicht_kg is per regel-totaal (UNIQUE 1-op-1 mapping)
      const gewichtKg = orderRegel?.gewicht_kg
      if (gewichtKg !== null && gewichtKg !== undefined) {
        totaalGewichtKg += Number(gewichtKg)
      }

      // Afleveradres alleen bij eerste regel van de order EN alleen als afwijkend
      let afleveradres: { naam: string; naam_2?: string; adres: string; postcode: string; plaats: string } | undefined
      if (r.order_id !== null && !aflGetoondPerOrder.has(r.order_id)) {
        const order = ordersById.get(r.order_id)
        if (order) {
          const aflAdres = (order.afl_adres ?? '').trim().toLowerCase()
          const aflPostcode = (order.afl_postcode ?? '').trim().toLowerCase()
          const afwijkend = aflAdres !== factAdres || aflPostcode !== factPostcode
          if (afwijkend && order.afl_naam && order.afl_adres && order.afl_postcode && order.afl_plaats) {
            afleveradres = {
              naam: order.afl_naam,
              naam_2: order.afl_naam_2 ?? undefined,
              adres: order.afl_adres,
              postcode: order.afl_postcode,
              plaats: order.afl_plaats,
            }
          }
        }
        aflGetoondPerOrder.add(r.order_id)
      }

      return {
        order_nr: r.order_nr ?? '',
        uw_referentie: r.uw_referentie ?? '',
        artikelnr: r.artikelnr ?? '',
        aantal,
        eenheid: 'St',
        omschrijving: r.omschrijving ?? '',
        omschrijving_2: r.omschrijving_2 ?? undefined,
        prijs: Number(r.prijs),
        bedrag: Number(r.bedrag),
        afleveradres,
      }
    })

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
        bank2: bedrijf.bank2,
        voorwaarden_nl: bedrijf.voorwaarden_nl,
        voorwaarden_de: bedrijf.voorwaarden_de,
        voorwaarden_en: bedrijf.voorwaarden_en,
      },
      logo: logoOptie,
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
        totaal_m2: totaalM2 > 0 ? totaalM2 : undefined,
        totaal_gewicht_kg: totaalGewichtKg > 0 ? totaalGewichtKg : undefined,
      },
      regels: renderRegels,
    })

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${factuur.factuur_nr}.pdf"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return jsonError(500, msg)
  }
})

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}
