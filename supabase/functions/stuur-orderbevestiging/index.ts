// Supabase Edge Function: stuur-orderbevestiging
//
// Genereert een PDF-orderbevestiging en stuurt die per e-mail naar de klant.
// Markeert de order vervolgens als bevestigd (orders.bevestigd_at).
//
// POST body (JSON):
//   { order_id: number, email?: string, bevestigd_door?: string }
//
// email is optioneel — fallback: debiteuren.email_overig → email_factuur → email_2
// (overig eerst: de orderbevestiging hoort naar het algemene/orderbevestiging-
// adres, niet naar het factuuradres — melding Marjon 11-06-2026)
// bevestigd_door is optioneel — naam/email van de medewerker

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { genereerOrderbevestigingPDF } from '../_shared/orderbevestiging-pdf.ts'
import { type Taal, bepaalTaal, vertaalOmschrijving } from '../_shared/klant-taal.ts'
import { sendFactuurEmail } from '../_shared/graph-mail-client.ts'
import { isoWeekJaar } from '../_shared/iso-week.ts'
import { berekenFactuurTotalen } from '../_shared/factuur-bedrag.ts'
import { effectiefBtwPct, isBtwVerlegd } from '../_shared/btw.ts'
import { resolveKarpiCode } from '../_shared/facturatie/artikel-presentatie.ts'
import { afwerkingPresentatie, fetchAfwerkingTypeMap } from '../_shared/afwerking-presentatie.ts'
import { logExternePayload } from '../_shared/externe-payload-audit.ts'
import { externReferentie } from '../_shared/referentie.ts'

const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MS_GRAPH_TENANT_ID  = Deno.env.get('MS_GRAPH_TENANT_ID')!
const MS_GRAPH_CLIENT_ID  = Deno.env.get('MS_GRAPH_CLIENT_ID')!
const MS_GRAPH_CLIENT_SECRET = Deno.env.get('MS_GRAPH_CLIENT_SECRET')!
const FROM_EMAIL          = Deno.env.get('FACTUUR_FROM_EMAIL') ?? Deno.env.get('ORDERBEVESTIGING_FROM_EMAIL')!
const REPLY_TO            = Deno.env.get('FACTUUR_REPLY_TO') ?? FROM_EMAIL
const KARPI_LOGO_BUCKET   = Deno.env.get('KARPI_LOGO_BUCKET') ?? 'public-assets'
const KARPI_LOGO_PATH     = Deno.env.get('KARPI_LOGO_PATH') ?? 'karpi-logo.jpg'

// ── Taal van mail + PDF: bepaald door het land van het factuuradres ─────────
// Taal-type, landmapping en regel-woordvertaling komen uit de gedeelde module
// _shared/klant-taal.ts (ook gebruikt door orderbevestiging-pdf.ts).
// Hieronder alleen de mail-specifieke teksten.
const VERTALINGEN: Record<Taal, {
  onderwerp: string
  aanhef: (naam: string) => string
  intro: (orderNr: string, referentie: string | null) => string
  klantnummer: string
  ordernummer: string
  referentie: string
  levering: string
  /** Mig 469: per-regel verzendweek-label voor maatwerk-stukken met materiaal op voorraad. */
  verzendweekRegel: string
  model: string
  vertegenwoordiger: string
  afleveradres: string
  afhalen: string
  totaal: string
  subtotaal: string
  btwOver: (percentage: string, bedrag: string) => string
  btwVerlegd: string
  totaalInclBtw: string
  disclaimer: string
  vragen: (email: string, telefoon: string) => string
  groet: string
}> = {
  nl: {
    onderwerp: 'Orderbevestiging',
    aanhef: (naam) => `Beste ${naam},`,
    intro: (orderNr, ref) => `Hartelijk dank voor uw bestelling. Bijgevoegd treft u de bevestiging aan van uw order <strong>${orderNr}</strong>${ref ? ` (uw ref: ${ref})` : ''}.`,
    klantnummer: 'Uw klantnummer',
    ordernummer: 'Ordernummer',
    referentie: 'Uw referentie',
    levering: 'Verwachte levering',
    verzendweekRegel: 'Verzendweek',
    model: 'Uw model',
    vertegenwoordiger: 'Uw vertegenwoordiger',
    afleveradres: 'Afleveradres',
    afhalen: 'Afhalen',
    totaal: 'Totaalbedrag',
    subtotaal: 'Totaalbedrag excl. btw',
    btwOver: (pct, bedrag) => `${pct}% btw over ${bedrag}`,
    btwVerlegd: 'BTW verlegd',
    totaalInclBtw: 'Totaalbedrag incl. btw',
    disclaimer: 'Een geringe maatafwijking van +/- 3% alsmede een kleurafwijking kan optreden.',
    vragen: (email, tel) => `Heeft u vragen over uw order? Neem dan contact met ons op via <a href="mailto:${email}">${email}</a> of ${tel}.`,
    groet: 'Met vriendelijke groet,',
  },
  de: {
    onderwerp: 'Auftragsbestätigung',
    aanhef: (naam) => `Sehr geehrte Damen und Herren von ${naam},`,
    intro: (orderNr, ref) => `Vielen Dank für Ihre Bestellung. Anbei erhalten Sie die Bestätigung Ihres Auftrags <strong>${orderNr}</strong>${ref ? ` (Ihre Referenz: ${ref})` : ''}.`,
    klantnummer: 'Ihre Kundennummer',
    ordernummer: 'Auftragsnummer',
    referentie: 'Ihre Referenz',
    levering: 'Voraussichtliche Lieferung',
    verzendweekRegel: 'Versandwoche',
    model: 'Ihr Modell',
    vertegenwoordiger: 'Ihr Vertreter',
    afleveradres: 'Lieferadresse',
    afhalen: 'Abholung',
    totaal: 'Gesamtbetrag',
    subtotaal: 'Gesamtbetrag exkl. MwSt.',
    btwOver: (pct, bedrag) => `${pct}% MwSt. auf ${bedrag}`,
    btwVerlegd: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)',
    totaalInclBtw: 'Gesamtbetrag inkl. MwSt.',
    disclaimer: 'Geringe Maßabweichungen von +/- 3% sowie Farbabweichungen sind möglich.',
    vragen: (email, tel) => `Haben Sie Fragen zu Ihrer Bestellung? Kontaktieren Sie uns über <a href="mailto:${email}">${email}</a> oder ${tel}.`,
    groet: 'Mit freundlichen Grüßen,',
  },
  fr: {
    onderwerp: 'Confirmation de commande',
    aanhef: (naam) => `Cher client ${naam},`,
    intro: (orderNr, ref) => `Merci pour votre commande. Vous trouverez ci-joint la confirmation de votre commande <strong>${orderNr}</strong>${ref ? ` (votre référence : ${ref})` : ''}.`,
    klantnummer: 'Votre numéro de client',
    ordernummer: 'Numéro de commande',
    referentie: 'Votre référence',
    levering: 'Livraison prévue',
    verzendweekRegel: 'Semaine d\'expédition',
    model: 'Votre modèle',
    vertegenwoordiger: 'Votre représentant',
    afleveradres: 'Adresse de livraison',
    afhalen: 'Enlèvement',
    totaal: 'Montant total',
    subtotaal: 'Montant total hors TVA',
    btwOver: (pct, bedrag) => `TVA ${pct}% sur ${bedrag}`,
    btwVerlegd: 'Autoliquidation de la TVA',
    totaalInclBtw: 'Montant total TVA comprise',
    disclaimer: 'Un léger écart de mesure de +/- 3 % ainsi qu\'une différence de couleur peuvent survenir.',
    vragen: (email, tel) => `Des questions sur votre commande ? Contactez-nous via <a href="mailto:${email}">${email}</a> ou ${tel}.`,
    groet: 'Cordialement,',
  },
  en: {
    onderwerp: 'Order confirmation',
    aanhef: (naam) => `Dear ${naam},`,
    intro: (orderNr, ref) => `Thank you for your order. Please find attached the confirmation of your order <strong>${orderNr}</strong>${ref ? ` (your reference: ${ref})` : ''}.`,
    klantnummer: 'Your customer number',
    ordernummer: 'Order number',
    referentie: 'Your reference',
    levering: 'Expected delivery',
    verzendweekRegel: 'Shipping week',
    model: 'Your model',
    vertegenwoordiger: 'Your sales representative',
    afleveradres: 'Delivery address',
    afhalen: 'Pickup',
    totaal: 'Total amount',
    subtotaal: 'Total amount excl. VAT',
    btwOver: (pct, bedrag) => `${pct}% VAT over ${bedrag}`,
    btwVerlegd: 'VAT reverse charged',
    totaalInclBtw: 'Total amount incl. VAT',
    disclaimer: 'A slight size deviation of +/- 3% as well as a colour variation may occur.',
    vragen: (email, tel) => `Questions about your order? Contact us via <a href="mailto:${email}">${email}</a> or ${tel}.`,
    groet: 'Kind regards,',
  },
}

// ── "Uw model": klant-eigen naam voor de kwaliteit/kleur-combinatie ─────────
// Bron-van-waarheid is de RPC resolve_klanteigen_naam (mig 199/200, zelfde
// resolutieketen als view snijplan_sticker_data uit mig 295). Géén regex op
// opgeslagen tekst — die bevat in de praktijk geen "Uw model"-aanduiding.
async function resolveKlantEigenNamen(
  supabase: ReturnType<typeof createClient>,
  debiteurNr: number,
  paren: { kwaliteit_code: string | null; kleur_code: string | null }[],
): Promise<Map<string, string>> {
  const uniek = new Map<string, { kwaliteit_code: string | null; kleur_code: string | null }>()
  for (const p of paren) {
    if (!p.kwaliteit_code) continue
    uniek.set(`${p.kwaliteit_code}|${p.kleur_code ?? ''}`, p)
  }

  const resultaat = new Map<string, string>()
  for (const [sleutel, p] of uniek) {
    const { data } = await supabase.rpc('resolve_klanteigen_naam', {
      p_debiteur_nr: debiteurNr,
      p_kwaliteit_code: p.kwaliteit_code,
      p_kleur_code: p.kleur_code,
    })
    if (data) resultaat.set(sleutel, data as string)
  }
  return resultaat
}

function formatBedrag(v: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(v)
}

// Mig 469: order_regels.verzendweek is 'YYYY-Www' (verzendweek_voor_datum, mig 228).
// Spiegelt formatVerzendweek() in frontend/src/components/orders/order-regels-table.tsx.
function formatVerzendweekLabel(w: string): string {
  const m = w.match(/^(\d{4})-W(\d{2})$/)
  if (!m) return w
  return `Wk ${parseInt(m[2])} · ${m[1]}`
}

function formatBtwPercentage(pct: number): string {
  return Number(pct).toFixed(2)
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)

  let body: { order_id: number; email?: string; bevestigd_door?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const { order_id, email: emailOverride, bevestigd_door } = body
  if (!order_id) return json({ error: 'order_id verplicht' }, 400)

  // ── Order ophalen ──────────────────────────────────────────────────────────
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select(`
      id, order_nr, orderdatum, afleverdatum, klant_referentie,
      debiteur_nr, bevestigd_at, vertegenw_code, afhalen,
      afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land,
      fact_naam, fact_land,
      debiteuren!orders_debiteur_nr_fkey(naam, email_factuur, email_overig, email_2, betaalconditie, btw_percentage, btw_verlegd_intracom)
    `)
    .eq('id', order_id)
    .single()

  if (orderErr || !order) return json({ error: 'Order niet gevonden' }, 404)

  const deb = (order as any).debiteuren as {
    naam: string
    email_factuur: string | null
    email_overig: string | null
    email_2: string | null
    betaalconditie: string | null
    btw_percentage: number | string | null
    btw_verlegd_intracom: boolean | null
  } | null

  // Vertegenwoordiger: snapshot op de order (vertegenw_code), opgezocht in medewerkers.
  let vertegenwoordigerNaam: string | null = null
  if ((order as any).vertegenw_code) {
    const { data: medewerker } = await supabase
      .from('medewerkers')
      .select('naam')
      .eq('code', (order as any).vertegenw_code)
      .maybeSingle()
    vertegenwoordigerNaam = medewerker?.naam ?? null
  }

  // E-mail bepalen — overig vóór factuur (zelfde ladder als de dialog-prefill)
  const toEmail = emailOverride
    ?? deb?.email_overig
    ?? deb?.email_factuur
    ?? deb?.email_2
    ?? null

  if (!toEmail) {
    return json({ error: 'Geen e-mailadres beschikbaar voor deze klant. Vul een e-mailadres (overig of factuur) in op de klantkaart of geef een e-mailadres op.' }, 422)
  }

  // ── Orderregels ophalen ────────────────────────────────────────────────────
  const { data: regelsRaw, error: regelsErr } = await supabase
    .from('order_regels')
    .select(`
      id, regelnummer, artikelnr, karpi_code, omschrijving, omschrijving_2,
      klant_referentie,
      orderaantal, prijs, korting_pct, bedrag,
      is_maatwerk, verzendweek,
      maatwerk_kwaliteit_code, maatwerk_kleur_code,
      maatwerk_afwerking, maatwerk_band_kleur,
      producten!order_regels_artikelnr_fkey(karpi_code, kwaliteit_code, kleur_code)
    `)
    .eq('order_id', order_id)
    .order('regelnummer')

  if (regelsErr) return json({ error: regelsErr.message }, 500)

  // Afwerking als omschrijving-suffix — zelfde regel als factuur/pakbon: de
  // bandkleur verschijnt alleen bij Breedband (afwerkingPresentatie).
  const afwerkingTypeMap = await fetchAfwerkingTypeMap(supabase)

  const regels = (regelsRaw ?? []).map((r: any) => {
    const afwerking = afwerkingPresentatie(r.maatwerk_afwerking, r.maatwerk_band_kleur, afwerkingTypeMap)
    const omschrijvingBasis = r.omschrijving ?? ''
    return {
      regelnummer: r.regelnummer,
      artikelnr: r.artikelnr,
      // Gedeelde karpi_code-ladder (ADR-0036): zelfde Karpi-code als op de factuur.
      karpi_code: resolveKarpiCode(r.karpi_code, r.producten?.karpi_code, r.artikelnr) || null,
      omschrijving: afwerking ? `${omschrijvingBasis} - afwerking: ${afwerking}` : omschrijvingBasis,
      omschrijving_2: r.omschrijving_2 ?? null,
      klant_referentie: r.klant_referentie ?? null,
      orderaantal: r.orderaantal ?? 0,
      prijs: r.prijs ?? null,
      korting_pct: r.korting_pct ?? null,
      bedrag: r.bedrag ?? null,
      // Resolutieketen gelijk aan view snijplan_sticker_data (mig 295):
      // maatwerk-snapshot wint van het gekoppelde product.
      kwaliteit_code: r.maatwerk_kwaliteit_code ?? r.producten?.kwaliteit_code ?? null,
      kleur_code: r.maatwerk_kleur_code ?? r.producten?.kleur_code ?? null,
      // Mig 469: per-regel verzendweek, alleen relevant/gezet voor maatwerk.
      is_maatwerk: r.is_maatwerk === true,
      verzendweek: r.verzendweek ?? null,
    }
  })

  // BTW: zelfde bron-van-waarheid als genereer_factuur_voor_bundel (mig 371) —
  // verlegd-vlag wint, anders debiteuren.btw_percentage met fallback 21. Zo
  // lopen orderbevestiging en factuur niet uit elkaar.
  const btwVerlegd = isBtwVerlegd(deb)
  const btwPercentage = effectiefBtwPct(deb)
  const { subtotaal, btw_bedrag: btwBedrag, totaal } = berekenFactuurTotalen(
    regels.map((r) => ({ bedrag: r.bedrag ?? 0 })),
    btwPercentage,
  )

  // ── Bedrijfsgegevens ───────────────────────────────────────────────────────
  const { data: configRow } = await supabase
    .from('app_config')
    .select('waarde')
    .eq('sleutel', 'bedrijfsgegevens')
    .maybeSingle()

  const cfg = (configRow?.waarde ?? {}) as Record<string, string>
  const bedrijf = {
    bedrijfsnaam: cfg.bedrijfsnaam ?? 'Karpi B.V.',
    adres:        cfg.adres ?? 'Tweede Broekdijk 10',
    postcode:     cfg.postcode ?? '7122 LB',
    plaats:       cfg.plaats ?? 'Aalten',
    telefoon:     cfg.telefoon ?? '',
    email:        cfg.email ?? '',
    website:      cfg.website ?? 'www.karpi.nl',
    kvk:          cfg.kvk ?? '',
    btw_nummer:   cfg.btw_nummer ?? '',
    iban:         cfg.iban ?? '',
    bic:          cfg.bic ?? '',
  }

  // ── Logo ophalen ───────────────────────────────────────────────────────────
  // Zelfde bucket/pad-conventie als factuur-pdf: bucket 'public-assets',
  // bestand 'karpi-logo.jpg' (de oude default 'documenten'/'logos/karpi-logo.jpg'
  // verwees naar een niet-bestaand object, dus het logo verscheen nooit).
  let logoBytes: Uint8Array | undefined
  try {
    const { data: logoData } = await supabase.storage.from(KARPI_LOGO_BUCKET).download(KARPI_LOGO_PATH)
    if (logoData) logoBytes = new Uint8Array(await logoData.arrayBuffer())
  } catch { /* logo optioneel */ }

  // ── Verzendweek berekenen ──────────────────────────────────────────────────
  // ISO-week uit de gedeelde UTC-kern — gelijk aan frontend + SQL. Voorheen een
  // lokale-tijd-berekening die rond middernacht/jaargrens kon afwijken op het
  // week-label dat de klant op de orderbevestiging ziet.
  function verzendweekLabel(isoDate: string | null): string | null {
    if (!isoDate) return null
    const { jaar, week } = isoWeekJaar(new Date(`${isoDate}T00:00:00Z`))
    return `Wk ${week} · ${jaar}`
  }

  // ── Taal bepalen: land van het factuuradres ────────────────────────────────
  // Genormaliseerd via de gedeelde SQL-functie normaliseer_land, zodat
  // 'DEUTSCHLAND'/'Germany'/'DE' allemaal naar dezelfde Duitse vertaling
  // resolven. Geldt voor mail én PDF-bijlage (zelfde taal, zelfde bewoording).
  const o = order as any
  let factLandIso2: string | null = null
  if (o.fact_land) {
    const { data: landData } = await supabase.rpc('normaliseer_land', { p_land: o.fact_land })
    factLandIso2 = (landData as string | null) ?? null
  }
  const taal = bepaalTaal(factLandIso2)
  const v = VERTALINGEN[taal]

  // Regel-omschrijvingen één keer woord-vertaald — dezelfde tekst op PDF en in
  // de mail (kwaliteit-/kleurcodes blijven onaangeroerd voor klanteigen-namen).
  const regelsVertaald = regels.map((r) => ({
    ...r,
    omschrijving: vertaalOmschrijving(r.omschrijving, taal),
    omschrijving_2: r.omschrijving_2 ? vertaalOmschrijving(r.omschrijving_2, taal) : null,
  }))

  // ── PDF genereren ──────────────────────────────────────────────────────────
  const pdfBytes = await genereerOrderbevestigingPDF({
    bedrijf,
    logo_bytes: logoBytes,
    order_nr: o.order_nr,
    orderdatum: o.orderdatum,
    debiteur_nr: o.debiteur_nr,
    vertegenwoordiger: vertegenwoordigerNaam,
    klant_referentie: externReferentie(o.klant_referentie),
    verzendweek: verzendweekLabel(o.afleverdatum),
    afleverdatum: o.afleverdatum ?? null,
    klant_naam: deb?.naam ?? o.fact_naam ?? 'Klant',
    afhalen: o.afhalen === true,
    afl_naam: o.afl_naam ?? o.afl_naam_2 ?? null,
    afl_adres: o.afl_adres ?? null,
    afl_postcode: o.afl_postcode ?? null,
    afl_stad: o.afl_plaats ?? null,
    afl_land: o.afl_land ?? null,
    regels: regelsVertaald,
    subtotaal,
    btw_percentage: btwPercentage,
    btw_verlegd: btwVerlegd,
    btw_bedrag: btwBedrag,
    totaal,
    betaalconditie: deb?.betaalconditie ?? null,
    taal,
  })

  // ── E-mail versturen ───────────────────────────────────────────────────────
  const klantNaam = deb?.naam ?? o.fact_naam ?? 'Klant'

  const klantEigenNamen = await resolveKlantEigenNamen(supabase, o.debiteur_nr, regels)

  const regelsHtml = regelsVertaald.map((r) => {
    const model = r.kwaliteit_code ? klantEigenNamen.get(`${r.kwaliteit_code}|${r.kleur_code ?? ''}`) ?? null : null
    // Per-regel verzendweek voor alle regeltypen — ook vaste-maat-regels kunnen
    // bij gemengde orders (deels voorraad, deels IO) elk een andere week hebben.
    const verzendweekRegel = r.verzendweek ? formatVerzendweekLabel(r.verzendweek) : null
    return `<tr>
      <td style="padding: 4px 8px; border-bottom: 1px solid #eee;">${r.omschrijving}${model ? `<br><span style="color:#888; font-size: 11px;">${v.model}: ${model}</span>` : ''}${r.klant_referentie ? `<br><span style="color:#888; font-size: 11px;">Ref: ${r.klant_referentie}</span>` : ''}${verzendweekRegel ? `<br><span style="color:#888; font-size: 11px;">${v.verzendweekRegel}: ${verzendweekRegel}</span>` : ''}</td>
      <td style="padding: 4px 8px; border-bottom: 1px solid #eee; text-align: right;">${r.orderaantal}</td>
      <td style="padding: 4px 8px; border-bottom: 1px solid #eee; text-align: right; white-space: nowrap;">${r.bedrag != null ? formatBedrag(r.bedrag) : ''}</td>
    </tr>`
  }).join('')

  const afleveradresHtml = o.afhalen
    ? `<p>
        <strong>${v.afhalen}:</strong><br>
        ${bedrijf.bedrijfsnaam}<br>
        ${bedrijf.adres}<br>
        ${bedrijf.postcode}  ${bedrijf.plaats}
      </p>`
    : (o.afl_adres || o.afl_postcode || o.afl_plaats)
      ? `<p>
          <strong>${v.afleveradres}:</strong><br>
          ${o.afl_naam && o.afl_naam !== klantNaam ? `${o.afl_naam}<br>` : ''}
          ${o.afl_adres ? `${o.afl_adres}<br>` : ''}
          ${[o.afl_postcode, o.afl_plaats].filter(Boolean).join('  ')}${o.afl_land && o.afl_land.toUpperCase() !== 'NL' ? `<br>${o.afl_land}` : ''}
        </p>`
      : ''

  const htmlBody = `
<div style="font-family: Arial, sans-serif; max-width: 600px; color: #333;">
  <p>${v.aanhef(klantNaam)}</p>
  <p>${v.intro(o.order_nr, externReferentie(o.klant_referentie))}</p>
  <p>
    <strong>${v.klantnummer}:</strong> ${o.debiteur_nr}<br>
    <strong>${v.ordernummer}:</strong> ${o.order_nr}<br>
    ${externReferentie(o.klant_referentie) ? `<strong>${v.referentie}:</strong> ${externReferentie(o.klant_referentie)}<br>` : ''}
    ${vertegenwoordigerNaam ? `<strong>${v.vertegenwoordiger}:</strong> ${vertegenwoordigerNaam}<br>` : ''}
    ${o.afleverdatum ? `<strong>${v.levering}:</strong> ${verzendweekLabel(o.afleverdatum) ?? ''}<br>` : ''}
  </p>
  ${afleveradresHtml}
  <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin: 12px 0;">
    ${regelsHtml}
    <tr>
      <td style="padding: 6px 8px; text-align: right;" colspan="2">${v.subtotaal}</td>
      <td style="padding: 6px 8px; text-align: right; white-space: nowrap;">${formatBedrag(subtotaal)}</td>
    </tr>
    <tr>
      <td style="padding: 6px 8px; text-align: right;" colspan="2">${btwVerlegd ? v.btwVerlegd : v.btwOver(formatBtwPercentage(btwPercentage), formatBedrag(subtotaal))}</td>
      <td style="padding: 6px 8px; text-align: right; white-space: nowrap;">${btwVerlegd ? '' : formatBedrag(btwBedrag)}</td>
    </tr>
    <tr>
      <td style="padding: 6px 8px; font-weight: bold; text-align: right;" colspan="2">${v.totaalInclBtw}</td>
      <td style="padding: 6px 8px; text-align: right; font-weight: bold; white-space: nowrap;">${formatBedrag(totaal)}</td>
    </tr>
  </table>
  <p style="font-size: 11px; color: #888;">${v.disclaimer}</p>
  <p>${v.vragen(bedrijf.email, bedrijf.telefoon)}</p>
  <p>${v.groet}<br><strong>${bedrijf.bedrijfsnaam}</strong></p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
  <p style="font-size: 11px; color: #999;">${bedrijf.adres}, ${bedrijf.postcode} ${bedrijf.plaats} | ${bedrijf.website} | KvK: ${bedrijf.kvk}</p>
</div>`

  const onderwerp = `${v.onderwerp} ${klantNaam} ${o.order_nr}`
  const pdfFilename = `Orderbevestiging-${o.order_nr}.pdf`

  // Verzendpoging + rauwe-payload-audit (richting 'out'). Loggen is best-effort
  // en gooit nooit; de PDF-bytes worden bewust uit raw/json gestript (alleen
  // bijlage-metadata, zoals hst-send de PDF uit de audit weglaat).
  let sendOk = false
  let sendFout: string | null = null
  try {
    await sendFactuurEmail({
      tenantId: MS_GRAPH_TENANT_ID,
      clientId: MS_GRAPH_CLIENT_ID,
      clientSecret: MS_GRAPH_CLIENT_SECRET,
      from: FROM_EMAIL,
      to: toEmail,
      replyTo: REPLY_TO,
      subject: onderwerp,
      html: htmlBody,
      attachments: [{
        filename: pdfFilename,
        content: pdfBytes,
      }],
    })
    sendOk = true
  } catch (e) {
    sendFout = e instanceof Error ? e.message : String(e)
  }

  const auditPayload = {
    from: FROM_EMAIL,
    to: toEmail,
    replyTo: REPLY_TO,
    subject: onderwerp,
    html: htmlBody,
    // Bijlage-metadata zonder de base64-PDF-bytes.
    attachments: [{ filename: pdfFilename, contentType: 'application/pdf', bytes: pdfBytes.length }],
  }
  await logExternePayload(supabase, {
    kanaal: 'orderbevestiging',
    richting: 'out',
    raw: JSON.stringify(auditPayload),
    json: { request: auditPayload, response: sendOk ? { ok: true } : null, ok: sendOk },
    bron: 'graph',
    externeId: null, // Graph sendMail geeft geen message-id terug
    status: sendOk ? 'verwerkt' : 'fout',
    orderId: o.id ?? null,
    fout: sendFout,
  })

  // Faalde de verzending, dan stopt de flow hier (zelfde gedrag als voorheen:
  // sendFactuurEmail gooide direct). De audit-rij is dan al weggeschreven.
  if (!sendOk) return json({ error: sendFout ?? 'E-mail versturen mislukt' }, 502)

  // ── Mig 366: PDF bewaren + e-mailtijdlijn-rij ──────────────────────────────
  // Best-effort: de bevestiging is al verstuurd, dit mag de flow niet laten
  // falen. PDF naar bucket `orderbevestigingen` (upsert bij hersturen) zodat
  // de tijdlijn-dialog hem via een signed URL kan openen.
  try {
    const pdfPath = `${o.id}/${pdfFilename}`
    const { error: uploadErr } = await supabase.storage
      .from('orderbevestigingen')
      .upload(pdfPath, pdfBytes, { contentType: 'application/pdf', upsert: true })
    if (uploadErr) console.warn(`[stuur-orderbevestiging] PDF-upload mislukt: ${uploadErr.message}`)

    const { error: logErr } = await supabase.from('verstuurde_emails').insert({
      order_id: o.id,
      soort: 'orderbevestiging',
      onderwerp,
      verzonden_aan: toEmail,
      html: htmlBody,
      bijlagen: uploadErr ? [] : [{ filename: pdfFilename, bucket: 'orderbevestigingen', path: pdfPath }],
    })
    if (logErr) console.warn(`[stuur-orderbevestiging] e-mail-log mislukt: ${logErr.message}`)
  } catch (err) {
    console.warn(`[stuur-orderbevestiging] e-mail-log mislukt: ${err}`)
  }

  // ── Order markeren als bevestigd ───────────────────────────────────────────
  const now = new Date().toISOString()
  const { data: updatedOrder } = await supabase
    .from('orders')
    .update({
      bevestigd_at: now,
      bevestigd_door: bevestigd_door ?? null,
      bevestiging_email: toEmail,
    })
    .eq('id', order_id)
    .select('status')
    .single()

  // Mig 503: log 'orderbevestiging_verstuurd' in order_events (best-effort).
  try {
    await supabase.from('order_events').insert({
      order_id,
      event_type: 'orderbevestiging_verstuurd',
      status_voor: updatedOrder?.status ?? null,
      status_na: updatedOrder?.status ?? 'Bevestigd',
      metadata: {
        email_naar: toEmail,
        gedaan_door: bevestigd_door ?? 'onbekend',
      },
    })
  } catch (e) {
    console.warn(`[stuur-orderbevestiging] order_events log mislukt: ${e}`)
  }

  console.log(`[stuur-orderbevestiging] order=${o.order_nr} → ${toEmail} (${bevestigd_door ?? 'onbekend'})`)

  return json({
    order_nr: o.order_nr,
    verstuurd_naar: toEmail,
    bevestigd_at: now,
  })
})
