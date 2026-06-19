// Supabase Edge Function: factuur-pdf
// Rendert een factuur real-time als PDF en streamt de bytes terug.
// Geen DB-mutaties, geen mail, geen EDI — pure preview/download voor de UI.
// Werkt op elke factuur, ongeacht status (Concept ook).
//
// Header + regels komen uit het canonieke Factuurdocument (ADR-0036): dezelfde
// Artikelpresentatie als de EDI-INVOIC. De PDF-specifieke verrijking
// (m²-/gewicht-totalen + afleveradres-per-order) blijft hier — die hoort niet in
// het gedeelde document.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { genereerFactuurPDF } from '../_shared/factuur-pdf.ts'
import { fetchFactuurDocument } from '../_shared/facturatie/factuur-document.ts'
import { naarFactuurPdfInput } from '../_shared/facturatie/factuur-pdf-renderer.ts'
import { bepaalTaal } from '../_shared/klant-taal.ts'
import {
  bereekenM2PerStuk,
  bouwIntracomStatRegel,
  fetchGoederencodePerKwaliteit,
} from '../_shared/facturatie/intracom-statregel.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface OrderRegelMeta {
  id: number
  gewicht_kg: number | string | null
  maatwerk_oppervlak_m2: number | string | null
  maatwerk_kwaliteit_code: string | null
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
  kwaliteit_code: string | null
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

    const bedrijfRes = await supabase
      .from('app_config')
      .select('waarde')
      .eq('sleutel', 'bedrijfsgegevens')
      .maybeSingle()
    if (bedrijfRes.error) return jsonError(500, `Fetch bedrijfsgegevens: ${bedrijfRes.error.message}`)
    if (!bedrijfRes.data?.waarde) {
      return jsonError(
        500,
        'Bedrijfsgegevens ontbreken — vul ze in via /instellingen/bedrijfsgegevens (app_config sleutel "bedrijfsgegevens")',
      )
    }
    const bedrijf = bedrijfRes.data.waarde as BedrijfConfig

    // Canoniek Factuurdocument (header + regels mét Artikelpresentatie).
    let doc
    try {
      doc = await fetchFactuurDocument(supabase, factuurId)
    } catch (e) {
      return jsonError(404, e instanceof Error ? e.message : String(e))
    }
    const base = naarFactuurPdfInput(doc)

    // Taal van de factuur: land van het factuuradres → ISO2 via normaliseer_land
    // (zelfde bron als de orderbevestiging). Default 'nl' bij leeg/onbekend land.
    let factLandIso2: string | null = null
    if (doc.header.fact_land) {
      const { data: landData } = await supabase.rpc('normaliseer_land', { p_land: doc.header.fact_land })
      factLandIso2 = (landData as string | null) ?? null
    }
    const taal = bepaalTaal(factLandIso2)

    // Secundaire fetches voor PDF-specifieke verrijking (m², gewicht, afleveradres).
    const orderIds = Array.from(new Set(doc.regels.map((r) => r.order_id).filter((v) => Number.isFinite(v))))
    const orderRegelIds = Array.from(new Set(doc.regels.map((r) => r.order_regel_id).filter((v) => Number.isFinite(v))))
    const artikelnrs = Array.from(new Set(doc.regels.map((r) => r.artikelnr).filter((v) => v.length > 0)))

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
            .select('id, gewicht_kg, maatwerk_oppervlak_m2, maatwerk_kwaliteit_code')
            .in('id', orderRegelIds)
        : Promise.resolve({ data: [] as OrderRegelMeta[], error: null }),
      artikelnrs.length > 0
        ? supabase
            .from('producten')
            .select('artikelnr, lengte_cm, breedte_cm, vorm, kwaliteit_code')
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

    // Mig 446: goederencode (Stat.nr.) per kwaliteit — alleen ophalen + tonen
    // bij intracommunautaire (buitenlandse, btw_verlegd) facturen. Op een
    // NL-factuur is dit niet relevant en blijft de fetch leeg.
    const kwaliteitCodes = doc.header.btw_verlegd
      ? Array.from(
          new Set(
            doc.regels
              .map((r) => {
                const orderRegel = orderRegelsById.get(r.order_regel_id)
                const product = r.artikelnr ? productenByArtikelnr.get(r.artikelnr) : undefined
                return orderRegel?.maatwerk_kwaliteit_code ?? product?.kwaliteit_code ?? null
              })
              .filter((v): v is string => !!v),
          ),
        )
      : []
    let goederencodeByKwaliteit: Map<string, string>
    try {
      goederencodeByKwaliteit = await fetchGoederencodePerKwaliteit(supabase, kwaliteitCodes)
    } catch (e) {
      return jsonError(500, e instanceof Error ? e.message : String(e))
    }

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

    // M² + gewicht per regel + afleveradres-per-order: PDF-specifieke verrijking
    // op het doc-gedreven regel-basis (base.regels). Indexen lopen 1-op-1 met
    // doc.regels (zelfde regelnummer-sortering).
    const factAdres = doc.header.fact_adres.trim().toLowerCase()
    const factPostcode = doc.header.fact_postcode.trim().toLowerCase()
    let totaalM2 = 0
    let totaalGewichtKg = 0
    const aflGetoondPerOrder = new Set<number>()

    const renderRegels = base.regels.map((br, i) => {
      const dr = doc.regels[i]
      const orderRegel = orderRegelsById.get(dr.order_regel_id)
      const product = dr.artikelnr ? productenByArtikelnr.get(dr.artikelnr) : undefined
      const aantal = br.aantal

      // m²-berekening per regel (per stuk × aantal)
      const m2PerStuk = bereekenM2PerStuk({
        maatwerkOppervlakM2: orderRegel?.maatwerk_oppervlak_m2,
        productLengteCm: product?.lengte_cm,
        productBreedteCm: product?.breedte_cm,
        productVorm: product?.vorm,
      })
      totaalM2 += m2PerStuk * aantal

      // gewicht: order_regels.gewicht_kg is per regel-totaal (UNIQUE 1-op-1 mapping)
      const gewichtKg = orderRegel?.gewicht_kg
      if (gewichtKg !== null && gewichtKg !== undefined) {
        totaalGewichtKg += Number(gewichtKg)
      }

      // Mig 446: Stat.nr.-regel (Intrastat-statistieknummer) op buitenlandse
      // (intracommunautaire) facturen — alleen als de kwaliteit een
      // goederencode heeft (anders stil weglaten, geen halve regel tonen).
      const kwaliteitCode = orderRegel?.maatwerk_kwaliteit_code ?? product?.kwaliteit_code ?? null
      const goederencode = kwaliteitCode ? goederencodeByKwaliteit.get(kwaliteitCode) : undefined
      const statRegel = bouwIntracomStatRegel({
        taal,
        btwVerlegd: doc.header.btw_verlegd,
        goederencode,
        gewichtKg,
        m2Totaal: m2PerStuk * aantal,
      })
      const omschrijving_2 = [br.omschrijving_2, statRegel].filter(Boolean).join('\n') || undefined

      // Afleveradres alleen bij eerste regel van de order EN alleen als afwijkend
      let afleveradres: { naam: string; naam_2?: string; adres: string; postcode: string; plaats: string } | undefined
      if (!aflGetoondPerOrder.has(dr.order_id)) {
        const order = ordersById.get(dr.order_id)
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
        aflGetoondPerOrder.add(dr.order_id)
      }

      return { ...br, omschrijving_2, afleveradres }
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
        ...base.factuur,
        totaal_m2: totaalM2 > 0 ? totaalM2 : undefined,
        totaal_gewicht_kg: totaalGewichtKg > 0 ? totaalGewichtKg : undefined,
      },
      regels: renderRegels,
      taal,
    })

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${doc.header.factuur_nr}.pdf"`,
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
