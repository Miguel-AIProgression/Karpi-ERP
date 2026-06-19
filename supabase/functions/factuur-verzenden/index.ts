// Supabase Edge Function: factuur-verzenden
// Drainst factuur_queue: genereert factuur (RPC), bouwt PDF, mailt met AV als bijlage.
// Zie plan: docs/superpowers/plans/2026-04-22-facturatie-module.md

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { genereerFactuurPDF } from '../_shared/factuur-pdf.ts'
import { sendFactuurEmail } from '../_shared/graph-mail-client.ts'
import { logExternePayload } from '../_shared/externe-payload-audit.ts'
import { buildKarpiInvoiceFixedWidth } from '../_shared/transus-formats/karpi-invoice-fixed-width.ts'
import { fetchFactuurDocument } from '../_shared/facturatie/factuur-document.ts'
import { naarFactuurPdfInput } from '../_shared/facturatie/factuur-pdf-renderer.ts'
import { bepaalTaal } from '../_shared/klant-taal.ts'
import {
  naarInvoiceInput,
  type FactuurInvoiceContext,
  type FactuurInvoiceOrder,
} from '../_shared/facturatie/factuur-invoice-renderer.ts'
import { fetchPakbonZending } from '../_shared/pakbon/fetch.ts'
import { bouwPakbonDocument } from '../_shared/pakbon/pakbon-document.ts'
import { genereerPakbonPDF } from '../_shared/pakbon/pakbon-pdf.ts'
import { fetchBedrijfMetLogo } from '../_shared/pakbon/bedrijf.ts'
import { fetchAfwerkingTypeMap } from '../_shared/afwerking-presentatie.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MS_GRAPH_TENANT_ID = Deno.env.get('MS_GRAPH_TENANT_ID')!
const MS_GRAPH_CLIENT_ID = Deno.env.get('MS_GRAPH_CLIENT_ID')!
const MS_GRAPH_CLIENT_SECRET = Deno.env.get('MS_GRAPH_CLIENT_SECRET')!
const FACTUUR_FROM = Deno.env.get('FACTUUR_FROM_EMAIL')!
const FACTUUR_REPLY_TO = Deno.env.get('FACTUUR_REPLY_TO') ?? FACTUUR_FROM
const AV_PATH = Deno.env.get('ALGEMENE_VOORWAARDEN_PATH') ?? 'algemene-voorwaarden-karpi-bv.pdf'

const MAX_BATCH = 10
const MAX_ATTEMPTS = 3

interface QueueItem {
  id: number
  debiteur_nr: number
  order_ids: number[]
  type: 'per_zending' | 'wekelijks'  // legacy — mig 237 dropt dit veld
  attempts: number
  zending_id: number | null  // mig 234 (ADR-0010): nieuwe bron-FK; mig 237 maakt 'm NOT NULL
  verzendweek: string | null  // mig 231: gevuld voor wekelijks-pad (legacy)
  factuur_id: number | null  // mig 428: concept-factuur gemaakt in fase 1 (projectie)
  gefinaliseerd_op: string | null  // mig 428: NULL = nog finaliseren; gezet = alleen (her)mailen
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
  btw_verlegd: boolean | null
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
  betaler: number | null
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

serve(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)

  // Mig 428 — FASE 1: projecteer concepten voor nieuwe pending per_zending-rijen
  // (factuur_id IS NULL). Geen delay-gate: het concept verschijnt direct in de
  // facturatie-module. Race-safe DB-side (FOR UPDATE SKIP LOCKED in de RPC).
  // Best-effort: een fout hier mag de finalisatie-fase niet blokkeren.
  const { error: conceptErr } = await supabase.rpc('verwerk_concept_queue', {
    p_max_batch: MAX_BATCH,
  })
  if (conceptErr) {
    console.warn(`[factuur-verzenden] concept-fase mislukt: ${conceptErr.message}`)
  }

  // Mig 227: atomic claim via RPC met FOR UPDATE SKIP LOCKED. Vervangt
  // SELECT-then-UPDATE die race-conditions veroorzaakte tussen parallelle
  // drains (cron-tik + handmatige aanroep konden dezelfde rij dubbel pakken).
  // Mig 428 — FASE 2: claim_factuur_queue_items claimt nu alleen rijen mét
  // concept (per_zending) of zonder zending (wekelijks/legacy), én beschikbaar.
  const { data: items, error: fetchErr } = await supabase.rpc('claim_factuur_queue_items', {
    p_max_batch: MAX_BATCH,
  })

  if (fetchErr) {
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  const results: Array<{ id: number; status: string; error?: string; factuur_nr?: string; edi_bericht_id?: number | null }> = []

  for (const item of (items ?? []) as QueueItem[]) {
    try {

      // ADR-0010 mig 234 / mig 428: 3-paden-dispatch met legacy-fallback.
      //   1. NIEUW (mig 428): item.zending_id gevuld → finaliseer_concept_factuur
      //      op de in fase 1 geprojecteerde concept-factuur (item.factuur_id).
      //      Idempotent tegen mail-retry via item.gefinaliseerd_op: is die al
      //      gezet, dan is de factuur al definitief → enkel (her)mailen.
      //   2. LEGACY wekelijks: zending_id NULL maar type='wekelijks' →
      //      genereer_factuur_voor_week (gedropt na mig 237)
      //   3. LEGACY per_zending: zending_id NULL en type='per_zending' →
      //      genereer_factuur (gedropt na mig 237)
      // Mig 234 step 5 / mig 428 zorgen dat zending_id + factuur_id +
      // gefinaliseerd_op meekomen via claim_factuur_queue_items.
      let factuurId: number
      if (item.zending_id != null) {
        // Per_zending: in fase 1 hoort er een concept te zijn. Defensief: maak er
        // alsnog één als de claim-gate 'm toch zonder factuur_id doorliet.
        if (item.factuur_id == null) {
          const { data, error } = await supabase.rpc('projecteer_concept_factuur', {
            p_zending_id: item.zending_id,
          })
          if (error) throw new Error(`RPC projecteer_concept_factuur: ${error.message}`)
          item.factuur_id = data as number
        }
        if (!item.gefinaliseerd_op) {
          const { data, error } = await supabase.rpc('finaliseer_concept_factuur', {
            p_zending_id: item.zending_id,
            p_factuur_id: item.factuur_id,
          })
          if (error) throw new Error(`RPC finaliseer_concept_factuur: ${error.message}`)
          factuurId = data as number
          // Markeer gefinaliseerd vóór de mail: faalt de mail daarna, dan
          // retry'en we alleen de mail (geen tweede finalisatie → geen flip-fout).
          await supabase
            .from('factuur_queue')
            .update({ gefinaliseerd_op: new Date().toISOString() })
            .eq('id', item.id)
        } else {
          // Al gefinaliseerd in een eerdere (mislukte-mail) run → hergebruik.
          factuurId = item.factuur_id
        }
      } else if (item.type === 'wekelijks') {
        if (!item.verzendweek) throw new Error(`Queue-rij ${item.id} type=wekelijks zonder verzendweek én zonder zending_id`)
        const { data, error } = await supabase.rpc('genereer_factuur_voor_week', {
          p_debiteur_nr: item.debiteur_nr,
          p_jaar_week: item.verzendweek,
        })
        if (error) throw new Error(`RPC genereer_factuur_voor_week (legacy): ${error.message}`)
        factuurId = data as number
      } else {
        const { data, error } = await supabase.rpc('genereer_factuur', {
          p_order_ids: item.order_ids,
        })
        if (error) throw new Error(`RPC genereer_factuur (legacy): ${error.message}`)
        factuurId = data as number
      }
      if (!factuurId) throw new Error('genereer_factuur* returned null')

      // 3. Laad factuur + regels + bedrijfsconfig + debiteur + vertegenwoordiger
      const [factuurRes, regelsRes, bedrijfRes, debiteurRes] = await Promise.all([
        supabase.from('facturen').select('*').eq('id', factuurId).single(),
        supabase.from('factuur_regels').select('*').eq('factuur_id', factuurId).order('regelnummer'),
        supabase.from('app_config').select('waarde').eq('sleutel', 'bedrijfsgegevens').single(),
        supabase
          .from('debiteuren')
          .select(
            'email_factuur, naam, vertegenw_code, gln_bedrijf, btw_nummer, betaler, ' +
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
      // In test_modus blijft de e-mail het echte kanaal: de INVOIC gaat als
      // test de wachtrij op, maar de partner moet de factuur nog gewoon per
      // mail krijgen. Mail onderdrukken kan pas bij een live EDI-kanaal.
      const ediMailOnderdrukt = ediFactuurActief && !ediConfig?.test_modus

      if (!debiteur.email_factuur && !ediFactuurActief) {
        throw new Error(`Debiteur ${item.debiteur_nr} heeft geen email_factuur`)
      }

      // 4. Bouw PDF uit het canonieke Factuurdocument (ADR-0036): zelfde
      // Artikelpresentatie als de EDI-INVOIC. Dit pad kent geen m²-/afleveradres-
      // verrijking (dat doet alleen de on-demand factuur-pdf-functie).
      const pdfDoc = await fetchFactuurDocument(supabase, factuurId)
      const pdfDeel = naarFactuurPdfInput(pdfDoc)
      // Taal van de factuur: land van het factuuradres → ISO2 (zelfde bron als de
      // orderbevestiging). Default 'nl' bij leeg/onbekend land.
      let factLandIso2: string | null = null
      if (pdfDoc.header.fact_land) {
        const { data: landData } = await supabase.rpc('normaliseer_land', { p_land: pdfDoc.header.fact_land })
        factLandIso2 = (landData as string | null) ?? null
      }
      const pdfTaal = bepaalTaal(factLandIso2)
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
        factuur: pdfDeel.factuur,
        regels: pdfDeel.regels,
        taal: pdfTaal,
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
      // Betaler-email alvast ophalen zodat verstuurd_naar correct wordt gelogd.
      let betalerEmail: string | null = null
      if (debiteur.betaler) {
        const { data: betalerRow } = await supabase
          .from('debiteuren')
          .select('email_factuur')
          .eq('debiteur_nr', debiteur.betaler)
          .maybeSingle()
        betalerEmail = betalerRow?.email_factuur ?? null
      }

      // EDI-partners krijgen de factuur uitsluitend via Transus zodra het kanaal
      // live is (ediMailOnderdrukt=true). In test_modus staat de INVOIC op de
      // testqueue maar is e-mail het echte kanaal — de PDF gaat dan gewoon mee.
      // De PDF blijft altijd in storage; de INVOIC is in stap 6 al gezet.
      if (!ediMailOnderdrukt && debiteur.email_factuur) {
        const { data: avBlob, error: avErr } = await supabase.storage
          .from('documenten')
          .download(AV_PATH)
        if (avErr || !avBlob) throw new Error(`Download AV: ${avErr?.message ?? 'geen data'}`)
        const avBytes = new Uint8Array(await avBlob.arrayBuffer())

        const orderIdsVoorLog = uniqueNumbers(regels.map((r) => Number(r.order_id)))

        // Pakbon(nen) als extra bijlage: één pakbon-PDF per zending die deze
        // factuur dekt — per_zending/bundel = 1, wekelijkse verzamelfactuur = N.
        // Volledig best-effort: een ontbrekende pakbon mag de factuur-mail nooit
        // blokkeren (zie genereerPakbonBijlagen).
        const pakbonBijlagen = await genereerPakbonBijlagen(
          supabase,
          item.debiteur_nr,
          orderIdsVoorLog,
        )
        const pakbonZin =
          pakbonBijlagen.length > 0
            ? `<p>De ${pakbonBijlagen.length > 1 ? 'pakbonnen vindt u' : 'pakbon vindt u'} eveneens als bijlage.</p>`
            : ''

        const emailHtml = `
<p>Geachte heer/mevrouw,</p>
<p>Hierbij ontvangt u bijgaand factuur <strong>${factuur.factuur_nr}</strong>.</p>
${pakbonZin}
<p>Onze algemene voorwaarden vindt u als bijlage bij deze e-mail.</p>
<p>Met vriendelijke groet,<br/>KARPI BV</p>
      `.trim()

        const attachments = [
          { filename: `${factuur.factuur_nr}.pdf`, content: pdfBytes },
          { filename: 'Algemene voorwaarden KARPI BV.pdf', content: avBytes },
          ...pakbonBijlagen.map((p) => ({ filename: p.filename, content: p.content })),
        ]

        // Mig 366: bijlage-verwijzingen voor de e-mailtijdlijn — bestanden staan
        // in storage zodat de dialog ze via signed URL kan openen. Pakbonnen
        // krijgen alleen een ref als hun storage-upload lukte (best-effort).
        const bijlagenMeta = [
          { filename: `${factuur.factuur_nr}.pdf`, bucket: 'facturen', path: pdfPath },
          { filename: 'Algemene voorwaarden KARPI BV.pdf', bucket: 'documenten', path: AV_PATH },
          ...pakbonBijlagen
            .filter((p) => p.bucket && p.path)
            .map((p) => ({ filename: p.filename, bucket: p.bucket as string, path: p.path as string })),
        ]

        // Stuur naar debiteur zelf
        await sendFactuurEmail({
          tenantId: MS_GRAPH_TENANT_ID,
          clientId: MS_GRAPH_CLIENT_ID,
          clientSecret: MS_GRAPH_CLIENT_SECRET,
          from: FACTUUR_FROM,
          to: debiteur.email_factuur,
          replyTo: FACTUUR_REPLY_TO,
          subject: `Factuur ${factuur.factuur_nr}`,
          html: emailHtml,
          attachments,
        })

        await logVerstuurdeEmails(supabase, {
          orderIds: orderIdsVoorLog,
          factuurId,
          onderwerp: `Factuur ${factuur.factuur_nr}`,
          verzondenAan: debiteur.email_factuur,
          html: emailHtml,
          bijlagen: bijlagenMeta,
        })

        // Rauwe-payload-audit (mig 324/325): leg de uitgaande factuur-e-mail vast.
        // Alleen de e-mail-tak — de EDI INVOIC wordt in edi_berichten gelogd, niet
        // hier. PDF/AV-bytes worden gestript; alleen mail-metadata + bijlage-refs.
        await logExternePayload(supabase, {
          kanaal: 'factuur',
          richting: 'out',
          bron: 'graph',
          externeId: factuur.factuur_nr,
          orderId: orderIdsVoorLog[0] ?? null,
          status: 'verwerkt',
          raw: JSON.stringify({ to: debiteur.email_factuur, subject: `Factuur ${factuur.factuur_nr}`, html: emailHtml }),
          json: {
            request: { to: debiteur.email_factuur, subject: `Factuur ${factuur.factuur_nr}`, html: emailHtml, bijlagen: bijlagenMeta },
            ok: true,
          },
        })

        // Stuur kopie naar betaler indien aanwezig en anders dan debiteur
        if (betalerEmail && betalerEmail !== debiteur.email_factuur) {
          await sendFactuurEmail({
            tenantId: MS_GRAPH_TENANT_ID,
            clientId: MS_GRAPH_CLIENT_ID,
            clientSecret: MS_GRAPH_CLIENT_SECRET,
            from: FACTUUR_FROM,
            to: betalerEmail,
            replyTo: FACTUUR_REPLY_TO,
            subject: `Factuur ${factuur.factuur_nr} (kopie voor betaler)`,
            html: emailHtml,
            attachments,
          })

          await logVerstuurdeEmails(supabase, {
            orderIds: orderIdsVoorLog,
            factuurId,
            onderwerp: `Factuur ${factuur.factuur_nr} (kopie voor betaler)`,
            verzondenAan: betalerEmail,
            html: emailHtml,
            bijlagen: bijlagenMeta,
          })

          // Rauwe-payload-audit: ook de betaler-kopie vastleggen (PDF gestript).
          await logExternePayload(supabase, {
            kanaal: 'factuur',
            richting: 'out',
            bron: 'graph',
            externeId: factuur.factuur_nr,
            orderId: orderIdsVoorLog[0] ?? null,
            status: 'verwerkt',
            raw: JSON.stringify({ to: betalerEmail, subject: `Factuur ${factuur.factuur_nr} (kopie voor betaler)`, html: emailHtml }),
            json: {
              request: { to: betalerEmail, subject: `Factuur ${factuur.factuur_nr} (kopie voor betaler)`, html: emailHtml, bijlagen: bijlagenMeta },
              ok: true,
            },
          })
        }
      }

      // 8. Factuur + queue finalisatie
      const nowIso = new Date().toISOString()
      await supabase
        .from('facturen')
        .update({
          status: 'Verstuurd',
          verstuurd_op: nowIso,
          verstuurd_naar: ediMailOnderdrukt
            ? 'EDI Transus'
            : [debiteur.email_factuur, betalerEmail].filter(Boolean).join(', ') || (ediBerichtId ? 'EDI Transus' : null),
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

      // Mig 227: claim is altijd gelukt (RPC zet 'processing' atomic),
      // dus we moeten de status hier terugschrijven naar 'pending' of 'failed'.
      await supabase
        .from('factuur_queue')
        .update({
          status: nextStatus,
          attempts: nextAttempts,
          last_error: msg,
          processing_started_at: null,
        })
        .eq('id', item.id)
      results.push({ id: item.id, status: nextStatus, error: msg })
    }
  }

  return new Response(
    JSON.stringify({ processed: results.length, results }),
    { headers: { 'content-type': 'application/json' } },
  )
})

// Mig 366: e-mailtijdlijn — één log-rij per betrokken order (bundel-factuur
// dekt meerdere orders). Best-effort: de mail is al verstuurd, logging mag de
// factuur-flow nooit laten falen.
async function logVerstuurdeEmails(
  supabase: ReturnType<typeof createClient>,
  input: {
    orderIds: number[]
    factuurId: number
    onderwerp: string
    verzondenAan: string
    html: string
    bijlagen: Array<{ filename: string; bucket: string; path: string }>
  },
): Promise<void> {
  try {
    if (input.orderIds.length === 0) return
    const { error } = await supabase.from('verstuurde_emails').insert(
      input.orderIds.map((orderId) => ({
        order_id: orderId,
        factuur_id: input.factuurId,
        soort: 'factuur',
        onderwerp: input.onderwerp,
        verzonden_aan: input.verzondenAan,
        html: input.html,
        bijlagen: input.bijlagen,
      })),
    )
    if (error) console.warn(`[factuur-verzenden] e-mail-log mislukt: ${error.message}`)
  } catch (err) {
    console.warn(`[factuur-verzenden] e-mail-log mislukt: ${err}`)
  }
}

interface PakbonBijlage {
  filename: string
  content: Uint8Array
  bucket?: string
  path?: string
}

// Genereert één pakbon-PDF per zending die deze factuur dekt (via zending_orders
// M2M op de gefactureerde orders). Een per_zending/bundel-factuur levert 1
// pakbon, een wekelijkse verzamelfactuur N (alle zendingen van die week).
// Volledig BEST-EFFORT: elke fout (geen zending, geen colli, render-fout) wordt
// gelogd en overgeslagen zodat de factuur-mail altijd doorgaat — een pakbon mag
// nooit de facturatie blokkeren. De server-side renderer komt uit _shared/pakbon
// (zelfde bron als de geprinte pakbon).
async function genereerPakbonBijlagen(
  supabase: ReturnType<typeof createClient>,
  debiteurNr: number,
  orderIds: number[],
): Promise<PakbonBijlage[]> {
  if (orderIds.length === 0) return []
  try {
    const { data: zoData, error: zoErr } = await supabase
      .from('zending_orders')
      .select('zending_id')
      .in('order_id', orderIds)
    if (zoErr) {
      console.warn(`[factuur-verzenden] pakbon: zendingen ophalen mislukt: ${zoErr.message}`)
      return []
    }
    const zendingOrders = (zoData ?? []) as Array<{ zending_id: number }>
    const zendingIds = uniqueNumbers(zendingOrders.map((r) => Number(r.zending_id)))
    if (zendingIds.length === 0) return []

    const { data: zData, error: zErr } = await supabase
      .from('zendingen')
      .select('zending_nr')
      .in('id', zendingIds)
      .order('zending_nr')
    if (zErr) {
      console.warn(`[factuur-verzenden] pakbon: zending_nr ophalen mislukt: ${zErr.message}`)
      return []
    }
    const zendingRijen = (zData ?? []) as Array<{ zending_nr: string }>
    const zendingNrs = zendingRijen.map((r) => String(r.zending_nr)).filter(Boolean)
    if (zendingNrs.length === 0) return []

    const { bedrijf, logo } = await fetchBedrijfMetLogo(supabase)
    const afwerkingTypes = await fetchAfwerkingTypeMap(supabase)

    const bijlagen: PakbonBijlage[] = []
    for (const zendingNr of zendingNrs) {
      try {
        const zending = await fetchPakbonZending(supabase, zendingNr)
        const doc = bouwPakbonDocument(zending, { afwerkingTypes })
        const bytes = await genereerPakbonPDF(doc, bedrijf, logo)
        const filename = `Pakbon-${zendingNr}.pdf`

        // Storage-upload óók best-effort: lukt het, dan krijgt de pakbon een
        // e-mailtijdlijn-referentie (signed URL). Faalt het, dan gaat de pakbon
        // nog steeds als bijlage mee — alleen zonder tijdlijn-ref.
        let bucket: string | undefined
        let path: string | undefined
        try {
          const kandidaatPad = `${debiteurNr}/pakbon/${zendingNr}.pdf`
          const up = await supabase.storage
            .from('facturen')
            .upload(kandidaatPad, bytes, { contentType: 'application/pdf', upsert: true })
          if (!up.error) {
            bucket = 'facturen'
            path = kandidaatPad
          }
        } catch {
          // upload mislukt — bijlage gaat zonder tijdlijn-ref mee
        }

        bijlagen.push({ filename, content: bytes, bucket, path })
      } catch (err) {
        console.warn(`[factuur-verzenden] pakbon ${zendingNr} overgeslagen: ${err}`)
      }
    }
    return bijlagen
  } catch (err) {
    console.warn(`[factuur-verzenden] pakbon-bijlagen mislukt: ${err}`)
    return []
  }
}

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

  // Gedeelde Factuurdocument-renderer (ADR-0036): zelfde pad als bouw-factuur-edi.
  const doc = await fetchFactuurDocument(supabase, factuur.id, { isTestMessage: ediConfig.test_modus })
  const orderIds = uniqueNumbers(regels.map((r) => Number(r.order_id)))
  const orders = await fetchOrdersForEdi(supabase, orderIds)
  const ctx: FactuurInvoiceContext = {
    bedrijf: {
      bedrijfsnaam: bedrijf.bedrijfsnaam,
      gln_eigen: bedrijf.gln_eigen ?? '8715954999998',
      adres: bedrijf.adres,
      postcode: bedrijf.postcode,
      plaats: bedrijf.plaats,
      land: bedrijf.land,
      btw_nummer: bedrijf.btw_nummer ?? null,
    },
    debiteur: {
      naam: debiteur.naam,
      btw_nummer: debiteur.btw_nummer,
      fact_naam: debiteur.fact_naam,
      fact_adres: debiteur.fact_adres,
      fact_postcode: debiteur.fact_postcode,
      fact_plaats: debiteur.fact_plaats,
      adres: debiteur.adres,
      postcode: debiteur.postcode,
      plaats: debiteur.plaats,
      land: debiteur.land,
      gln_bedrijf: debiteur.gln_bedrijf,
    },
    orders: orders as unknown as FactuurInvoiceOrder[],
    deliveryNoteNumber: factuur.factuur_nr,
  }
  const input = naarInvoiceInput(doc, ctx)
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

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter((v) => Number.isFinite(v) && v > 0)))
}
