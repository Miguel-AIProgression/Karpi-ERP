// Supabase Edge Function: verstuur-factuur-handmatig
// Verstuurt een factuur handmatig per e-mail naar een opgegeven e-mailadres.
// Werkt voor elke factuurstatus (ook Concept / creditnotas).
//
// POST body: { factuur_id: number, email: string }
//
// Flow:
// 1. Haal factuur + regels + bedrijf op
// 2. Bepaal of het een creditnota is (voor de PDF-titel)
// 3. Genereer PDF + sla op in storage
// 4. Verstuur e-mail via MS Graph naar het opgegeven e-mailadres
// 5. Update facturen: verstuurd_op, verstuurd_naar, status → 'Verstuurd'

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { genereerFactuurPDF } from '../_shared/factuur-pdf.ts'
import { sendFactuurEmail } from '../_shared/graph-mail-client.ts'
import { logExternePayload } from '../_shared/externe-payload-audit.ts'
import { bepaalTaal } from '../_shared/klant-taal.ts'
import type { FactuurPDFInput, FactuurHeader, FactuurPDFRegel } from '../_shared/factuur-pdf.ts'

const SUPABASE_URL           = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MS_GRAPH_TENANT_ID     = Deno.env.get('MS_GRAPH_TENANT_ID')!
const MS_GRAPH_CLIENT_ID     = Deno.env.get('MS_GRAPH_CLIENT_ID')!
const MS_GRAPH_CLIENT_SECRET = Deno.env.get('MS_GRAPH_CLIENT_SECRET')!
const FACTUUR_FROM           = Deno.env.get('FACTUUR_FROM_EMAIL')!
const FACTUUR_REPLY_TO       = Deno.env.get('FACTUUR_REPLY_TO') ?? FACTUUR_FROM

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
  let email: string
  try {
    const body = await req.json()
    factuurId = Number(body?.factuur_id ?? 0)
    email = (body?.email ?? '').toString().trim()
  } catch {
    return jsonError(400, 'Ongeldig JSON body')
  }
  if (!Number.isFinite(factuurId) || factuurId <= 0) {
    return jsonError(400, 'factuur_id ontbreekt of is ongeldig')
  }
  if (!email || !email.includes('@')) {
    return jsonError(400, 'Geldig e-mailadres verplicht')
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)

  try {
    // 1. Haal factuur + debiteur op
    const { data: factuur, error: factuurErr } = await supabase
      .from('facturen')
      .select(`
        id, factuur_nr, debiteur_nr, factuurdatum, vervaldatum,
        subtotaal, btw_percentage, btw_bedrag, totaal,
        fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
        btw_nummer, btw_verlegd, opmerkingen, credit_voor_factuur_id, pdf_storage_path,
        debiteuren(vertegenwoordiger_code)
      `)
      .eq('id', factuurId)
      .maybeSingle()

    if (factuurErr) return jsonError(500, `Factuur ophalen: ${factuurErr.message}`)
    if (!factuur) return jsonError(404, `Factuur ${factuurId} niet gevonden`)

    const isCreditnota = Boolean(factuur.credit_voor_factuur_id)
    const deb = factuur.debiteuren as { vertegenwoordiger_code: string | null } | null

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

    // 5. PDF opbouwen
    const factuurHeader: FactuurHeader = {
      factuur_nr:         factuur.factuur_nr,
      factuurdatum:       factuur.factuurdatum,
      debiteur_nr:        factuur.debiteur_nr,
      vertegenwoordiger:  deb?.vertegenwoordiger_code ?? '',
      fact_naam:          factuur.fact_naam ?? '',
      fact_adres:         factuur.fact_adres ?? '',
      fact_postcode:      factuur.fact_postcode ?? '',
      fact_plaats:        factuur.fact_plaats ?? '',
      subtotaal:          Number(factuur.subtotaal),
      btw_percentage:     Number(factuur.btw_percentage),
      btw_bedrag:         Number(factuur.btw_bedrag),
      totaal:             Number(factuur.totaal),
      btw_verlegd:        factuur.btw_verlegd === true,
      btw_nummer_afnemer: factuur.btw_nummer ?? null,
      is_creditnota:      isCreditnota,
    }

    const pdfRegels: FactuurPDFRegel[] = (regelsRaw ?? []).map((r) => ({
      order_nr:       r.order_nr ?? '',
      uw_referentie:  r.uw_referentie ?? '',
      artikelnr:      r.artikelnr ?? '',
      aantal:         Number(r.aantal),
      eenheid:        'St',
      omschrijving:   r.omschrijving ?? '',
      omschrijving_2: r.omschrijving_2 ?? undefined,
      prijs:          Number(r.prijs),
      bedrag:         Number(r.bedrag),
    }))

    const pdfInput: FactuurPDFInput = {
      bedrijf: {
        bedrijfsnaam:             bedrijf.bedrijfsnaam,
        adres:                    bedrijf.adres,
        postcode:                 bedrijf.postcode,
        plaats:                   bedrijf.plaats,
        land:                     bedrijf.land,
        telefoon:                 bedrijf.telefoon,
        email:                    bedrijf.email,
        website:                  bedrijf.website,
        kvk:                      bedrijf.kvk,
        btw_nummer:               bedrijf.btw_nummer,
        iban:                     bedrijf.iban,
        bic:                      bedrijf.bic,
        bank:                     bedrijf.bank,
        rekeningnummer:           bedrijf.rekeningnummer,
        betalingscondities_tekst: bedrijf.betalingscondities_tekst,
        fax:                      bedrijf.fax,
      },
      factuur: factuurHeader,
      regels:  pdfRegels,
      taal,
    }

    // Logo ophalen (best-effort)
    const { data: logoConfig } = await supabase
      .from('app_config').select('waarde').eq('sleutel', 'factuur_logo').maybeSingle()
    if (logoConfig?.waarde) {
      const lc = logoConfig.waarde as { bucket?: string; path?: string; format?: string }
      if (lc.bucket && lc.path) {
        const { data: logoBlob } = await supabase.storage.from(lc.bucket).download(lc.path)
        if (logoBlob) {
          pdfInput.logo = {
            bytes:      new Uint8Array(await logoBlob.arrayBuffer()),
            format:     (lc.format ?? 'png') as 'png' | 'jpg',
            breedte_mm: 40,
            hoogte_mm:  15,
          }
        }
      }
    }

    // 6. PDF genereren
    const pdfBytes = await genereerFactuurPDF(pdfInput)

    // Sla PDF op in storage
    const mapNaam = isCreditnota ? 'creditnota' : 'facturen'
    const pdfPath = `${factuur.debiteur_nr}/${mapNaam}/${factuur.factuur_nr}.pdf`
    await supabase.storage
      .from('facturen')
      .upload(pdfPath, pdfBytes, { contentType: 'application/pdf', upsert: true })

    // 7. E-mail versturen
    const documentLabel = isCreditnota ? 'creditnota' : 'factuur'
    const emailHtml = `
<p>Geachte heer/mevrouw,</p>
<p>Hierbij ontvangt u bijgaand ${documentLabel} <strong>${factuur.factuur_nr}</strong>.</p>
<p>Met vriendelijke groet,<br/>KARPI BV</p>
    `.trim()

    await sendFactuurEmail({
      tenantId:     MS_GRAPH_TENANT_ID,
      clientId:     MS_GRAPH_CLIENT_ID,
      clientSecret: MS_GRAPH_CLIENT_SECRET,
      from:         FACTUUR_FROM,
      to:           email,
      replyTo:      FACTUUR_REPLY_TO,
      subject:      `${isCreditnota ? 'Creditnota' : 'Factuur'} ${factuur.factuur_nr}`,
      html:         emailHtml,
      attachments:  [{ filename: `${factuur.factuur_nr}.pdf`, content: pdfBytes }],
    })

    // 8. Factuur bijwerken
    const nowIso = new Date().toISOString()
    await supabase
      .from('facturen')
      .update({
        status:           'Verstuurd',
        verstuurd_op:     nowIso,
        verstuurd_naar:   email,
        pdf_storage_path: pdfPath,
      })
      .eq('id', factuurId)

    // 9. Rauwe-payload-audit (best-effort)
    await logExternePayload(supabase, {
      kanaal:    'factuur-handmatig',
      richting:  'out',
      bron:      'graph',
      externeId: factuur.factuur_nr,
      orderId:   null,
      status:    'verwerkt',
      raw:       JSON.stringify({ to: email, subject: `Factuur ${factuur.factuur_nr}` }),
      json:      { request: { to: email }, ok: true },
    })

    return jsonOk({ ok: true, factuur_nr: factuur.factuur_nr, verstuurd_naar: email })
  } catch (err) {
    console.error('[verstuur-factuur-handmatig]', err)
    return jsonError(500, err instanceof Error ? err.message : String(err))
  }
})
