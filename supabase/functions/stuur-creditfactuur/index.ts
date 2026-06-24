// Supabase Edge Function: stuur-creditfactuur
// Genereert een PDF van een creditnota en verstuurt hem per e-mail naar de klant.
//
// POST body: { factuur_id: number }
//
// Flow:
// 1. Haal creditnota op uit DB (valideer dat het een creditnota is + nog niet verstuurd)
// 2. Haal debiteur + e-mailadres op
// 3. Haal bedrijfsgegevens op
// 4. Genereer PDF direct via de gedeelde factuur-pdf renderer
// 5. Stuur e-mail met PDF bijlage via MS Graph
// 6. Update facturen.verstuurd_op / verstuurd_naar / status → 'Verstuurd'

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { genereerFactuurPDF } from '../_shared/factuur-pdf.ts'
import { sendFactuurEmail } from '../_shared/graph-mail-client.ts'
import { logExternePayload } from '../_shared/externe-payload-audit.ts'
import { bepaalTaal } from '../_shared/klant-taal.ts'
import type { FactuurPDFInput, FactuurHeader, FactuurPDFRegel } from '../_shared/factuur-pdf.ts'

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MS_GRAPH_TENANT_ID    = Deno.env.get('MS_GRAPH_TENANT_ID')!
const MS_GRAPH_CLIENT_ID    = Deno.env.get('MS_GRAPH_CLIENT_ID')!
const MS_GRAPH_CLIENT_SECRET = Deno.env.get('MS_GRAPH_CLIENT_SECRET')!
const FACTUUR_FROM          = Deno.env.get('FACTUUR_FROM_EMAIL')!
const FACTUUR_REPLY_TO      = Deno.env.get('FACTUUR_REPLY_TO') ?? FACTUUR_FROM
const AV_PATH               = Deno.env.get('ALGEMENE_VOORWAARDEN_PATH') ?? 'algemene-voorwaarden-karpi-bv.pdf'

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonError(405, 'Alleen POST ondersteund')

  let factuurId: number
  try {
    const body = await req.json()
    factuurId = Number(body?.factuur_id ?? 0)
  } catch {
    return jsonError(400, 'Ongeldig JSON body')
  }
  if (!Number.isFinite(factuurId) || factuurId <= 0) {
    return jsonError(400, 'factuur_id ontbreekt of is ongeldig')
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)

  try {
    // 1. Haal creditnota + debiteur op
    const { data: factuur, error: factuurErr } = await supabase
      .from('facturen')
      .select(`
        id, factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status,
        subtotaal, btw_percentage, btw_bedrag, totaal,
        fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
        btw_nummer, btw_verlegd, opmerkingen, credit_voor_factuur_id,
        verstuurd_op,
        debiteuren(naam, email_factuur, land, btw_nummer, vertegenwoordiger_code)
      `)
      .eq('id', factuurId)
      .maybeSingle()

    if (factuurErr) return jsonError(500, `Factuur ophalen: ${factuurErr.message}`)
    if (!factuur) return jsonError(404, `Factuur ${factuurId} niet gevonden`)
    if (!factuur.credit_voor_factuur_id) {
      return jsonError(400, 'Dit is geen creditnota (credit_voor_factuur_id is leeg)')
    }

    const deb = factuur.debiteuren as {
      naam: string
      email_factuur: string | null
      land: string | null
      btw_nummer: string | null
      vertegenwoordiger_code: string | null
    } | null

    if (!deb?.email_factuur) {
      return jsonError(400, `Debiteur ${factuur.debiteur_nr} heeft geen email_factuur`)
    }

    // 2. Haal factuurregels op
    const { data: regelsRaw, error: regelsErr } = await supabase
      .from('factuur_regels')
      .select('regelnummer, artikelnr, omschrijving, omschrijving_2, uw_referentie, order_nr, aantal, prijs, korting_pct, bedrag, btw_percentage')
      .eq('factuur_id', factuurId)
      .order('regelnummer')
    if (regelsErr) return jsonError(500, `Factuurregels ophalen: ${regelsErr.message}`)

    // 3. Bedrijfsgegevens
    const { data: bedrijfRow, error: bedrijfErr } = await supabase
      .from('app_config').select('waarde').eq('sleutel', 'bedrijfsgegevens').maybeSingle()
    if (bedrijfErr || !bedrijfRow?.waarde) {
      return jsonError(500, 'Bedrijfsgegevens ontbreken in app_config')
    }
    const bedrijf = bedrijfRow.waarde as {
      bedrijfsnaam: string; adres: string; postcode: string; plaats: string; land: string
      telefoon: string; email: string; website: string; kvk: string; btw_nummer: string
      iban: string; bic: string; bank: string; rekeningnummer: string
      betalingscondities_tekst: string; fax?: string
    }

    // 4. Taal bepalen vanuit factuurland
    let factLandIso2: string | null = null
    if (factuur.fact_land) {
      const { data: landData } = await supabase.rpc('normaliseer_land', { p_land: factuur.fact_land })
      factLandIso2 = (landData as string | null) ?? null
    }
    const taal = bepaalTaal(factLandIso2)

    // 5. PDF-input opbouwen
    const factuurHeader: FactuurHeader = {
      factuur_nr:    factuur.factuur_nr,
      factuurdatum:  factuur.factuurdatum,
      debiteur_nr:   factuur.debiteur_nr,
      vertegenwoordiger: deb.vertegenwoordiger_code ?? '',
      fact_naam:     factuur.fact_naam ?? '',
      fact_adres:    factuur.fact_adres ?? '',
      fact_postcode: factuur.fact_postcode ?? '',
      fact_plaats:   factuur.fact_plaats ?? '',
      subtotaal:     Number(factuur.subtotaal),
      btw_percentage: Number(factuur.btw_percentage),
      btw_bedrag:    Number(factuur.btw_bedrag),
      totaal:        Number(factuur.totaal),
      btw_verlegd:   factuur.btw_verlegd === true,
      btw_nummer_afnemer: factuur.btw_nummer ?? null,
      is_creditnota: true,  // Zet CREDITNOTA-titel in PDF
    }

    const pdfRegels: FactuurPDFRegel[] = (regelsRaw ?? []).map((r) => ({
      order_nr:      r.order_nr ?? '',
      uw_referentie: r.uw_referentie ?? '',
      artikelnr:     r.artikelnr ?? '',
      aantal:        Number(r.aantal),
      eenheid:       'St',
      omschrijving:  r.omschrijving ?? '',
      omschrijving_2: r.omschrijving_2 ?? undefined,
      prijs:         Number(r.prijs),
      bedrag:        Number(r.bedrag),
    }))

    const pdfInput: FactuurPDFInput = {
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
      factuur: factuurHeader,
      regels:  pdfRegels,
      taal,
    }

    // Optioneel logo ophalen
    const { data: logoConfig } = await supabase
      .from('app_config').select('waarde').eq('sleutel', 'factuur_logo').maybeSingle()
    if (logoConfig?.waarde) {
      const lc = logoConfig.waarde as { bucket?: string; path?: string; format?: string }
      if (lc.bucket && lc.path) {
        const { data: logoBlob } = await supabase.storage.from(lc.bucket).download(lc.path)
        if (logoBlob) {
          pdfInput.logo = {
            bytes: new Uint8Array(await logoBlob.arrayBuffer()),
            format: (lc.format ?? 'png') as 'png' | 'jpg',
            breedte_mm: 40,
            hoogte_mm:  15,
          }
        }
      }
    }

    // 6. PDF genereren
    const pdfBytes = await genereerFactuurPDF(pdfInput)

    // Sla PDF op in storage (bucket: facturen, pad: <debiteur_nr>/creditnota/<factuur_nr>.pdf)
    const pdfPath = `${factuur.debiteur_nr}/creditnota/${factuur.factuur_nr}.pdf`
    await supabase.storage
      .from('facturen')
      .upload(pdfPath, pdfBytes, { contentType: 'application/pdf', upsert: true })

    // 7. AV ophalen (best-effort)
    let avBytes: Uint8Array | null = null
    try {
      const { data: avBlob } = await supabase.storage.from('documenten').download(AV_PATH)
      if (avBlob) avBytes = new Uint8Array(await avBlob.arrayBuffer())
    } catch { /* best-effort */ }

    // 8. E-mail versturen
    const emailHtml = `
<p>Geachte heer/mevrouw,</p>
<p>Hierbij ontvangt u de creditnota <strong>${factuur.factuur_nr}</strong>.</p>
<p>Met vriendelijke groet,<br/>KARPI BV</p>
    `.trim()

    const attachments: Array<{ filename: string; content: Uint8Array }> = [
      { filename: `${factuur.factuur_nr}.pdf`, content: pdfBytes },
    ]
    if (avBytes) {
      attachments.push({ filename: 'Algemene voorwaarden KARPI BV.pdf', content: avBytes })
    }

    await sendFactuurEmail({
      tenantId:     MS_GRAPH_TENANT_ID,
      clientId:     MS_GRAPH_CLIENT_ID,
      clientSecret: MS_GRAPH_CLIENT_SECRET,
      from:         FACTUUR_FROM,
      to:           deb.email_factuur,
      replyTo:      FACTUUR_REPLY_TO,
      subject:      `Creditnota ${factuur.factuur_nr}`,
      html:         emailHtml,
      attachments,
    })

    // 9. Factuur bijwerken: verstuurd_op / verstuurd_naar / status / pdf_storage_path
    await supabase
      .from('facturen')
      .update({
        status:           'Verstuurd',
        verstuurd_op:     new Date().toISOString(),
        verstuurd_naar:   deb.email_factuur,
        pdf_storage_path: pdfPath,
      })
      .eq('id', factuurId)

    // 10. Rauwe-payload-audit (mig 325)
    await logExternePayload(supabase, {
      kanaal:    'creditfactuur',
      richting:  'out',
      bron:      'graph',
      externeId: factuur.factuur_nr,
      orderId:   null,
      status:    'verwerkt',
      raw:       JSON.stringify({ to: deb.email_factuur, subject: `Creditnota ${factuur.factuur_nr}` }),
      json:      { request: { to: deb.email_factuur }, ok: true },
    })

    return jsonOk({ ok: true, factuur_nr: factuur.factuur_nr, verstuurd_naar: deb.email_factuur })
  } catch (err) {
    console.error('[stuur-creditfactuur]', err)
    return jsonError(500, err instanceof Error ? err.message : String(err))
  }
})
