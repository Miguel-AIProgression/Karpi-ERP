// Supabase Edge Function: stuur-orderbevestiging
//
// Genereert een PDF-orderbevestiging en stuurt die per e-mail naar de klant.
// Markeert de order vervolgens als bevestigd (orders.bevestigd_at).
//
// POST body (JSON):
//   { order_id: number, email?: string, bevestigd_door?: string }
//
// email is optioneel — fallback: debiteuren.email_factuur → debiteuren.email
// bevestigd_door is optioneel — naam/email van de medewerker

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { genereerOrderbevestigingPDF } from '../_shared/orderbevestiging-pdf.ts'
import { sendFactuurEmail } from '../_shared/resend-client.ts'
import { isoWeekJaar } from '../_shared/iso-week.ts'

const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY      = Deno.env.get('RESEND_API_KEY')!
const FROM_EMAIL          = Deno.env.get('FACTUUR_FROM_EMAIL') ?? Deno.env.get('ORDERBEVESTIGING_FROM_EMAIL')!
const REPLY_TO            = Deno.env.get('FACTUUR_REPLY_TO') ?? FROM_EMAIL
const KARPI_LOGO_PATH     = Deno.env.get('KARPI_LOGO_PATH') ?? 'logos/karpi-logo.jpg'

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
      debiteur_nr, bevestigd_at,
      afl_naam, afl_bedrijf, afl_adres, afl_postcode, afl_stad, afl_land,
      fact_naam,
      debiteuren!orders_debiteur_nr_fkey(naam, email_factuur, email)
    `)
    .eq('id', order_id)
    .single()

  if (orderErr || !order) return json({ error: 'Order niet gevonden' }, 404)

  const deb = (order as any).debiteuren as {
    naam: string
    email_factuur: string | null
    email: string | null
  } | null

  // E-mail bepalen
  const toEmail = emailOverride
    ?? deb?.email_factuur
    ?? deb?.email
    ?? null

  if (!toEmail) {
    return json({ error: 'Geen e-mailadres beschikbaar voor deze klant. Vul email_factuur in op de klantkaart of geef een e-mailadres op.' }, 422)
  }

  // ── Orderregels ophalen ────────────────────────────────────────────────────
  const { data: regelsRaw, error: regelsErr } = await supabase
    .from('order_regels')
    .select(`
      id, regelnummer, artikelnr, karpi_code, omschrijving, omschrijving_2,
      orderaantal, prijs, bedrag,
      producten!order_regels_artikelnr_fkey(karpi_code)
    `)
    .eq('order_id', order_id)
    .order('regelnummer')

  if (regelsErr) return json({ error: regelsErr.message }, 500)

  const regels = (regelsRaw ?? []).map((r: any) => ({
    regelnummer: r.regelnummer,
    artikelnr: r.artikelnr,
    karpi_code: r.karpi_code ?? r.producten?.karpi_code ?? null,
    omschrijving: r.omschrijving ?? '',
    omschrijving_2: r.omschrijving_2 ?? null,
    orderaantal: r.orderaantal ?? 0,
    prijs: r.prijs ?? null,
    bedrag: r.bedrag ?? null,
  }))

  const totaal = regels.reduce((s: number, r: any) => s + (r.bedrag ?? 0), 0)

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
  let logoBytes: Uint8Array | undefined
  try {
    const { data: logoData } = await supabase.storage.from('documenten').download(KARPI_LOGO_PATH)
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

  // ── PDF genereren ──────────────────────────────────────────────────────────
  const o = order as any
  const pdfBytes = await genereerOrderbevestigingPDF({
    bedrijf,
    logo_bytes: logoBytes,
    order_nr: o.order_nr,
    orderdatum: o.orderdatum,
    klant_referentie: o.klant_referentie ?? null,
    verzendweek: verzendweekLabel(o.afleverdatum),
    afleverdatum: o.afleverdatum ?? null,
    klant_naam: deb?.naam ?? o.fact_naam ?? 'Klant',
    afl_naam: o.afl_naam ?? o.afl_bedrijf ?? null,
    afl_adres: o.afl_adres ?? null,
    afl_postcode: o.afl_postcode ?? null,
    afl_stad: o.afl_stad ?? null,
    afl_land: o.afl_land ?? null,
    regels,
    totaal,
  })

  // ── E-mail versturen ───────────────────────────────────────────────────────
  const bevestigingsdatum = new Date().toLocaleDateString('nl-NL', { day: '2-digit', month: 'long', year: 'numeric' })

  const htmlBody = `
<div style="font-family: Arial, sans-serif; max-width: 600px; color: #333;">
  <p>Beste ${deb?.naam ?? 'klant'},</p>
  <p>Hartelijk dank voor uw bestelling. Bijgevoegd treft u de bevestiging aan van uw order <strong>${o.order_nr}</strong>${o.klant_referentie ? ` (uw ref: ${o.klant_referentie})` : ''}.
  </p>
  <p>
    <strong>Ordernummer:</strong> ${o.order_nr}<br>
    ${o.klant_referentie ? `<strong>Uw referentie:</strong> ${o.klant_referentie}<br>` : ''}
    ${o.afleverdatum ? `<strong>Verwachte levering:</strong> ${verzendweekLabel(o.afleverdatum) ?? ''}<br>` : ''}
  </p>
  <p>Heeft u vragen over uw order? Neem dan contact met ons op via <a href="mailto:${bedrijf.email}">${bedrijf.email}</a> of ${bedrijf.telefoon}.</p>
  <p>Met vriendelijke groet,<br><strong>${bedrijf.bedrijfsnaam}</strong></p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
  <p style="font-size: 11px; color: #999;">${bedrijf.adres}, ${bedrijf.postcode} ${bedrijf.plaats} | ${bedrijf.website} | KvK: ${bedrijf.kvk}</p>
</div>`

  await sendFactuurEmail({
    apiKey: RESEND_API_KEY,
    from: FROM_EMAIL,
    to: toEmail,
    replyTo: REPLY_TO,
    subject: `Orderbevestiging ${o.order_nr}${o.klant_referentie ? ` — ${o.klant_referentie}` : ''}`,
    html: htmlBody,
    attachments: [{
      filename: `Orderbevestiging-${o.order_nr}.pdf`,
      content: pdfBytes,
    }],
  })

  // ── Order markeren als bevestigd ───────────────────────────────────────────
  const now = new Date().toISOString()
  await supabase
    .from('orders')
    .update({
      bevestigd_at: now,
      bevestigd_door: bevestigd_door ?? null,
      bevestiging_email: toEmail,
    })
    .eq('id', order_id)

  console.log(`[stuur-orderbevestiging] order=${o.order_nr} → ${toEmail} (${bevestigd_door ?? 'onbekend'})`)

  return json({
    order_nr: o.order_nr,
    verstuurd_naar: toEmail,
    bevestigd_at: now,
  })
})
