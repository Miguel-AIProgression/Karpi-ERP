// Supabase Edge Function: factuur-verzenden
// Drainst factuur_queue: genereert factuur (RPC), bouwt PDF, mailt met AV als bijlage.
// Zie plan: docs/superpowers/plans/2026-04-22-facturatie-module.md

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { genereerFactuurPDF } from '../_shared/factuur-pdf.ts'
import { sendFactuurEmail } from '../_shared/resend-client.ts'

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

  const results: Array<{ id: number; status: string; error?: string; factuur_nr?: string }> = []

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
          .select('email_factuur, naam, vertegenw_code')
          .eq('debiteur_nr', item.debiteur_nr)
          .single(),
      ])
      if (factuurRes.error) throw new Error(`Fetch factuur: ${factuurRes.error.message}`)
      if (regelsRes.error) throw new Error(`Fetch regels: ${regelsRes.error.message}`)
      if (bedrijfRes.error) throw new Error(`Fetch bedrijfsgegevens: ${bedrijfRes.error.message}`)
      if (debiteurRes.error) throw new Error(`Fetch debiteur: ${debiteurRes.error.message}`)

      const factuur = factuurRes.data
      const regels = regelsRes.data ?? []
      const bedrijf = bedrijfRes.data.waarde as Record<string, string>
      const debiteur = debiteurRes.data

      if (!debiteur.email_factuur) {
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
          aantal: r.aantal,
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

      // 6. Download algemene voorwaarden
      const { data: avBlob, error: avErr } = await supabase.storage
        .from('documenten')
        .download(AV_PATH)
      if (avErr || !avBlob) throw new Error(`Download AV: ${avErr?.message ?? 'geen data'}`)
      const avBytes = new Uint8Array(await avBlob.arrayBuffer())

      // 7. Verstuur email met factuur-PDF + AV als bijlage
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

      // 8. Factuur + queue finalisatie
      const nowIso = new Date().toISOString()
      await supabase
        .from('facturen')
        .update({
          status: 'Verstuurd',
          verstuurd_op: nowIso,
          verstuurd_naar: debiteur.email_factuur,
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

      results.push({ id: item.id, status: 'done', factuur_nr: factuur.factuur_nr })
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
