// Supabase Edge Function: factuur-verzenden
// Drainst factuur_queue: genereert factuur (RPC), bouwt PDF, mailt met AV als bijlage.
// Zie plan: docs/superpowers/plans/2026-04-22-facturatie-module.md

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { genereerFactuurPDF } from '../_shared/factuur-pdf.ts'
import { sendFactuurEmail } from '../_shared/graph-mail-client.ts'
import { logExternePayload } from '../_shared/externe-payload-audit.ts'
import { buildKarpiInvoiceFixedWidth } from '../_shared/transus-formats/karpi-invoice-fixed-width.ts'
import { fetchFactuurDocument, type FactuurDocument } from '../_shared/facturatie/factuur-document.ts'
import { naarFactuurPdfInput } from '../_shared/facturatie/factuur-pdf-renderer.ts'
import { bepaalTaal, type Taal } from '../_shared/klant-taal.ts'
import type { FactuurPDFRegel } from '../_shared/factuur-pdf.ts'
import {
  bereekenM2PerStuk,
  bouwIntracomStatRegel,
  fetchGoederencodePerKwaliteit,
  fetchVervoerderCodePerOrder,
} from '../_shared/facturatie/intracom-statregel.ts'
import { fetchBetaalconditie, fetchOrderPdfMeta, metEdiPrefix } from '../_shared/facturatie/factuur-pdf-verrijking.ts'
import { HARD_BLOCK_REGELINGEN, type BtwRegeling } from '../_shared/btw.ts'
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
  // Mig 456: BTW-regeling-gate (zie metBtwRegelingBlokkade hieronder).
  btw_regeling: string | null
  btw_controle_nodig_sinds: string | null
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
  email_pakbon: string | null   // mig 496: optioneel pakbon-specifiek adres (terugval: factuuradres)
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
        if (item.factuur_id != null) {
          // Retry pad: factuur al aangemaakt in vorige poging maar e-mail faalde.
          // Sla de RPC over (no_data_found anders) en stuur alleen de e-mail opnieuw.
          factuurId = item.factuur_id
        } else {
          const { data, error } = await supabase.rpc('genereer_factuur_voor_week', {
            p_debiteur_nr: item.debiteur_nr,
            p_jaar_week: item.verzendweek,
          })
          if (error) throw new Error(`RPC genereer_factuur_voor_week (legacy): ${error.message}`)
          factuurId = data as number
          // Schrijf factuur_id tussentijds terug zodat een e-mail-retry de RPC
          // kan overslaan (spiegelt gefinaliseerd_op-patroon bij per_zending).
          await supabase.from('factuur_queue').update({ factuur_id: factuurId }).eq('id', item.id)
        }
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
            'email_factuur, email_pakbon, naam, vertegenw_code, gln_bedrijf, btw_nummer, betaler, ' +
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

      // Mig 456 (gecorrigeerd): blokkeer het VERSTUREN als de BTW-regeling
      // onzeker is — de factuur is al aangemaakt (Concept, zichtbaar met de
      // "BTW controle nodig"-banner). Niet blokkerend voor eu_b2b_icl zonder
      // btw-nummer (mig 164-besluit, advisory). Bewust ná de factuur-INSERT/
      // UPDATE i.p.v. in de SQL-RPC, anders zou de factuur nooit zichtbaar
      // worden (zie mig 456-correctie-commentaar).
      if (
        factuur.btw_controle_nodig_sinds &&
        HARD_BLOCK_REGELINGEN.has(factuur.btw_regeling as BtwRegeling)
      ) {
        throw new Error(
          `BTW-regeling vereist bevestiging vóór verzending (factuur ${factuur.factuur_nr}, ` +
            `regeling ${factuur.btw_regeling}) — bevestig op de factuur-pagina.`,
        )
      }

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
      // Artikelpresentatie als de EDI-INVOIC. Dit pad kent geen m²-totaal-/
      // afleveradres-verrijking (dat doet alleen de on-demand factuur-pdf-
      // functie) — de Stat.nr.-regel (mig 446) wordt hier wél toegevoegd,
      // want dit is de daadwerkelijk verzonden factuur.
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

      // Mig 450: EDI-prefix + "Auftrag" (alle facturen) + debiteur-specifieke
      // betaalconditie — zelfde verrijking als het on-demand preview-pad
      // (factuur-pdf/index.ts), hier ook toegepast op de daadwerkelijk
      // verzonden factuur.
      const pdfOrderIds = uniqueNumbers(pdfDoc.regels.map((r) => r.order_id))
      const [orderMetaById, betaalconditie] = await Promise.all([
        fetchOrderPdfMeta(supabase, pdfOrderIds),
        fetchBetaalconditie(supabase, pdfDoc.header.debiteur_nr),
      ])
      let pdfRegels = pdfDeel.regels.map((br, i) => {
        const dr = pdfDoc.regels[i]
        const meta = orderMetaById.get(dr.order_id)
        return {
          ...br,
          uw_referentie: metEdiPrefix(br.uw_referentie, meta),
          oud_order_nr: meta?.oud_order_nr ?? null,
        }
      })
      if (pdfDoc.header.btw_verlegd) {
        pdfRegels = await metIntracomStatRegels(supabase, pdfDoc, pdfRegels, pdfTaal)
      }

      // Logo (zelfde bron als de pakbon + on-demand factuur-preview) zodat de
      // verzonden factuur-PDF visueel matcht met de pakbon-PDF. Best-effort:
      // ontbreekt het logo, dan rendert de factuur het tekstmerk (oud gedrag).
      const { logo: factuurLogo } = await fetchBedrijfMetLogo(supabase)

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
        factuur: { ...pdfDeel.factuur, betalingscondities_tekst: betaalconditie },
        regels: pdfRegels,
        taal: pdfTaal,
        logo: factuurLogo ? { ...factuurLogo, hoogte_mm: 18 } : undefined,
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

      // 7. Verstuur de factuurmail (+ losse pakbonmail), indien ingesteld.
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
      //
      // Verzoek Piet-Hein 25-06: factuur en pakbon gaan in TWEE aparte mails.
      // De factuurmail bevat alléén de factuur-PDF; de pakbonmail alléén de
      // pakbon-PDF(s) en gaat naar het pakbon-adres (terugval: factuuradres).
      // De algemene voorwaarden gaan in geen van beide nog als bijlage mee.
      if (!ediMailOnderdrukt && debiteur.email_factuur) {
        const orderIdsVoorLog = uniqueNumbers(regels.map((r) => Number(r.order_id)))

        // --- Factuurmail: alléén de factuur-PDF ---
        const factuurHtml = `
<p>Geachte heer/mevrouw,</p>
<p>Hierbij ontvangt u bijgaand factuur <strong>${factuur.factuur_nr}</strong>.</p>
<p>Met vriendelijke groet,<br/>KARPI BV</p>
      `.trim()
        const factuurAttachments = [{ filename: `${factuur.factuur_nr}.pdf`, content: pdfBytes }]
        const factuurBijlagenMeta = [{ filename: `${factuur.factuur_nr}.pdf`, bucket: 'facturen', path: pdfPath }]

        await verstuurEnLog(supabase, {
          to: debiteur.email_factuur,
          subject: `Factuur ${factuur.factuur_nr}`,
          html: factuurHtml,
          attachments: factuurAttachments,
          bijlagenMeta: factuurBijlagenMeta,
          orderIds: orderIdsVoorLog,
          factuurId,
          kanaal: 'factuur',
          factuurNr: factuur.factuur_nr,
        })

        // Kopie naar betaler indien aanwezig en anders dan debiteur
        if (betalerEmail && betalerEmail !== debiteur.email_factuur) {
          await verstuurEnLog(supabase, {
            to: betalerEmail,
            subject: `Factuur ${factuur.factuur_nr} (kopie voor betaler)`,
            html: factuurHtml,
            attachments: factuurAttachments,
            bijlagenMeta: factuurBijlagenMeta,
            orderIds: orderIdsVoorLog,
            factuurId,
            kanaal: 'factuur',
            factuurNr: factuur.factuur_nr,
          })
        }

        // --- Pakbonmail: altijd apart, alléén de pakbon-PDF(s) ---
        // Eén pakbon-PDF per zending die deze factuur dekt — per_zending/bundel = 1,
        // wekelijkse verzamelfactuur = N. Best-effort: een ontbrekende pakbon mag
        // de factuur-flow nooit blokkeren (zie genereerPakbonBijlagen).
        const pakbonBijlagen = await genereerPakbonBijlagen(supabase, item.debiteur_nr, orderIdsVoorLog)
        if (pakbonBijlagen.length > 0) {
          // Pakbon-adres (mig 496 / verzoek 25-06): email_pakbon, terugval factuuradres.
          const pakbonTo =
            [debiteur.email_pakbon, debiteur.email_factuur].map((v) => v?.trim()).find((v) => v) ?? ''
          // BEST-EFFORT: de factuur is al verstuurd, dus een pakbon-mailfout mag het
          // queue-item niet laten retryen (= dubbele factuur) — eigen try/catch.
          try {
            const meervoud = pakbonBijlagen.length > 1
            await verstuurEnLog(supabase, {
              to: pakbonTo,
              subject: `Pakbon${meervoud ? 'nen' : ''} bij factuur ${factuur.factuur_nr}`,
              html: `
<p>Geachte heer/mevrouw,</p>
<p>Hierbij ontvangt u de pakbon${meervoud ? 'nen' : ''} behorend bij factuur <strong>${factuur.factuur_nr}</strong> als bijlage.</p>
<p>Met vriendelijke groet,<br/>KARPI BV</p>
            `.trim(),
              attachments: pakbonBijlagen.map((p) => ({ filename: p.filename, content: p.content })),
              bijlagenMeta: pakbonBijlagen
                .filter((p) => p.bucket && p.path)
                .map((p) => ({ filename: p.filename, bucket: p.bucket as string, path: p.path as string })),
              orderIds: orderIdsVoorLog,
              factuurId,
              kanaal: 'pakbon',
              factuurNr: factuur.factuur_nr,
            })
          } catch (pakbonMailErr) {
            console.warn(
              `[factuur-verzenden] pakbon-mail mislukt (factuur ${factuur.factuur_nr}): ${pakbonMailErr}`,
            )
          }
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

// Verstuur één mail (factuur of pakbon) + leg 'm vast in de e-mailtijdlijn
// (verstuurde_emails) en de rauwe-payload-audit (externe_payloads). De drie
// stappen horen bij elkaar bij elke uitgaande mail — vandaar één seam, zodat
// factuurmail, betaler-kopie en pakbonmail niet drie keer hetzelfde triplet
// kopiëren. Gooit door als de e-mail zelf faalt; de caller bepaalt of dat
// fataal is (factuur: ja → retry) of best-effort (pakbon: try/catch).
async function verstuurEnLog(
  supabase: ReturnType<typeof createClient>,
  args: {
    to: string
    subject: string
    html: string
    attachments: Array<{ filename: string; content: Uint8Array }>
    bijlagenMeta: Array<{ filename: string; bucket: string; path: string }>
    orderIds: number[]
    factuurId: number
    kanaal: 'factuur' | 'pakbon'
    factuurNr: string
  },
): Promise<void> {
  await sendFactuurEmail({
    tenantId: MS_GRAPH_TENANT_ID,
    clientId: MS_GRAPH_CLIENT_ID,
    clientSecret: MS_GRAPH_CLIENT_SECRET,
    from: FACTUUR_FROM,
    to: args.to,
    replyTo: FACTUUR_REPLY_TO,
    subject: args.subject,
    html: args.html,
    attachments: args.attachments,
  })

  await logVerstuurdeEmails(supabase, {
    orderIds: args.orderIds,
    factuurId: args.factuurId,
    onderwerp: args.subject,
    verzondenAan: args.to,
    html: args.html,
    bijlagen: args.bijlagenMeta,
  })

  // Rauwe-payload-audit (mig 324/325): leg de uitgaande mail vast. PDF-bytes
  // worden gestript; alleen mail-metadata + bijlage-refs.
  await logExternePayload(supabase, {
    kanaal: args.kanaal,
    richting: 'out',
    bron: 'graph',
    externeId: args.factuurNr,
    orderId: args.orderIds[0] ?? null,
    status: 'verwerkt',
    raw: JSON.stringify({ to: args.to, subject: args.subject, html: args.html }),
    json: {
      request: { to: args.to, subject: args.subject, html: args.html, bijlagen: args.bijlagenMeta },
      ok: true,
    },
  })
}

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

/**
 * Mig 446: verrijkt de PDF-regels met de Intrastat-Stat.nr.-regel — alleen
 * aangeroepen bij intracommunautaire (btw_verlegd) facturen. Eigen, minimale
 * fetch (geen afleveradres/m²-totalen — dat blijft het on-demand preview-pad,
 * zie factuur-pdf/index.ts) zodat het reguliere NL-factuurpad geen extra
 * queries krijgt.
 */
async function metIntracomStatRegels(
  supabase: ReturnType<typeof createClient>,
  doc: FactuurDocument,
  regels: FactuurPDFRegel[],
  taal: Taal,
): Promise<FactuurPDFRegel[]> {
  const orderRegelIds = uniqueNumbers(doc.regels.map((r) => r.order_regel_id))
  const artikelnrs = Array.from(new Set(doc.regels.map((r) => r.artikelnr).filter((v) => v.length > 0)))

  const [orderRegelsRes, productenRes] = await Promise.all([
    orderRegelIds.length > 0
      ? supabase
          .from('order_regels')
          .select('id, gewicht_kg, maatwerk_oppervlak_m2, maatwerk_kwaliteit_code')
          .in('id', orderRegelIds)
      : Promise.resolve({ data: [], error: null }),
    artikelnrs.length > 0
      ? supabase
          .from('producten')
          .select('artikelnr, lengte_cm, breedte_cm, vorm, kwaliteit_code')
          .in('artikelnr', artikelnrs)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (orderRegelsRes.error) throw new Error(`Fetch order_regels (stat.nr.): ${orderRegelsRes.error.message}`)
  if (productenRes.error) throw new Error(`Fetch producten (stat.nr.): ${productenRes.error.message}`)

  interface OrderRegelMeta {
    id: number
    gewicht_kg: number | string | null
    maatwerk_oppervlak_m2: number | string | null
    maatwerk_kwaliteit_code: string | null
  }
  interface ProductMeta {
    artikelnr: string
    lengte_cm: number | null
    breedte_cm: number | null
    vorm: string | null
    kwaliteit_code: string | null
  }
  const orderRegelsById = new Map<number, OrderRegelMeta>()
  for (const orr of (orderRegelsRes.data ?? []) as OrderRegelMeta[]) orderRegelsById.set(orr.id, orr)
  const productenByArtikelnr = new Map<string, ProductMeta>()
  for (const p of (productenRes.data ?? []) as ProductMeta[]) productenByArtikelnr.set(p.artikelnr, p)

  const kwaliteitCodes = Array.from(
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
  const goederencodeByKwaliteit = await fetchGoederencodePerKwaliteit(supabase, kwaliteitCodes)
  const orderIds = uniqueNumbers(doc.regels.map((r) => r.order_id))
  const vervoerderByOrder = await fetchVervoerderCodePerOrder(supabase, orderIds)

  return regels.map((br, i) => {
    const dr = doc.regels[i]
    const orderRegel = orderRegelsById.get(dr.order_regel_id)
    const product = dr.artikelnr ? productenByArtikelnr.get(dr.artikelnr) : undefined
    const m2PerStuk = bereekenM2PerStuk({
      maatwerkOppervlakM2: orderRegel?.maatwerk_oppervlak_m2,
      productLengteCm: product?.lengte_cm,
      productBreedteCm: product?.breedte_cm,
      productVorm: product?.vorm,
    })
    const kwaliteitCode = orderRegel?.maatwerk_kwaliteit_code ?? product?.kwaliteit_code ?? null
    const goederencode = kwaliteitCode ? goederencodeByKwaliteit.get(kwaliteitCode) : undefined
    const statRegel = bouwIntracomStatRegel({
      taal,
      btwVerlegd: doc.header.btw_verlegd,
      goederencode,
      gewichtKg: orderRegel?.gewicht_kg,
      m2Totaal: m2PerStuk * br.aantal,
      vervoerderCode: vervoerderByOrder.get(dr.order_id),
    })
    return {
      ...br,
      omschrijving_2: [br.omschrijving_2, statRegel].filter(Boolean).join('\n') || undefined,
    }
  })
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
