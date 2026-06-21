// Supabase Edge Function: auto-plan-groep
// Automatische snijplanning: release gepland → heroptimaliseer → auto-approve
//
// Orchestreert het volledige auto-plan proces voor één kwaliteit/kleur groep:
// 1. Lock verkrijgen (race condition preventie)
// 2. Gepland + "Wacht op inkoop"-stukken vrijgeven
// 3. Alle Wacht/Gepland stukken ophalen + best-of-both packing
//    (Guillotine + FFDH per rol, kies beste — zie guillotine-packing.ts)
// 4. Voorstel opslaan + automatisch goedkeuren (echte rollen)
// 4b. Tweede pas: stukken die nergens fysiek pasten alsnog matchen tegen
//     openstaande rol-inkoop (virtuele rol, in-memory, mig 437/438)
// 5. Lock vrijgeven

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { packAcrossRolls } from '../_shared/guillotine-packing.ts'
import { validateShelfMesLimiet } from '../_shared/shelf-mes-validator.ts'
import type { Roll, SnijplanPiece } from '../_shared/ffdh-packing.ts'
import {
  fetchStukken,
  fetchUitwisselbareParen,
  fetchBeschikbareRollen,
  fetchBezettePlaatsingen,
  fetchOpenInkoopRegels,
  fetchStandaardBreedte,
  fetchOudeRolToewijzingen,
  buildFifoOptions,
  saveVoorstel,
} from '../_shared/db-helpers.ts'
import { PLANBAAR } from '../_shared/snijplan-status.ts'
import { berekenHaalbaarheid, type SnijDeadlineConfig } from '../_shared/snij-haalbaarheid.ts'
import { STANDAARD_WERKTIJDEN, isoDatum, type Werktijden } from '../_shared/werkagenda.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

// ---------------------------------------------------------------------------
// Lock helpers (atomic via database RPCs)
// ---------------------------------------------------------------------------

async function acquireLock(
  supabase: ReturnType<typeof createClient>,
  kwaliteitCode: string,
  kleurCode: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('acquire_snijplan_lock', {
    p_kwaliteit: kwaliteitCode,
    p_kleur: kleurCode,
  })
  if (error) throw error
  return data === true
}

async function releaseLock(
  supabase: ReturnType<typeof createClient>,
  kwaliteitCode: string,
  kleurCode: string,
): Promise<void> {
  await supabase.rpc('release_snijplan_lock', {
    p_kwaliteit: kwaliteitCode,
    p_kleur: kleurCode,
  })
}

// ---------------------------------------------------------------------------
// Snij-deadline-config (Fase 2 verdringingscheck) — zelfde app_config-sleutels
// als check-levertijd's lokale fetchConfig, hier alleen de 2 velden die
// `berekenHaalbaarheid` nodig heeft.
// ---------------------------------------------------------------------------

async function fetchSnijDeadlineConfig(
  supabase: ReturnType<typeof createClient>,
): Promise<{ config: SnijDeadlineConfig; werktijden: Werktijden }> {
  const config: SnijDeadlineConfig = {
    logistieke_buffer_dagen: 2,
    dag_order_snij_buffer_werkdagen: 2,
  }
  let werktijden: Werktijden = STANDAARD_WERKTIJDEN

  const { data } = await supabase
    .from('app_config')
    .select('sleutel, waarde')
    .in('sleutel', ['productie_planning', 'werkagenda'])
  for (const row of (data ?? []) as Array<{ sleutel: string; waarde: Record<string, unknown> }>) {
    if (row.sleutel === 'productie_planning') {
      const w = row.waarde
      if (typeof w.logistieke_buffer_dagen === 'number') config.logistieke_buffer_dagen = w.logistieke_buffer_dagen
      if (typeof w.dag_order_snij_buffer_werkdagen === 'number') {
        config.dag_order_snij_buffer_werkdagen = w.dag_order_snij_buffer_werkdagen
      }
    } else if (row.sleutel === 'werkagenda') {
      werktijden = { ...STANDAARD_WERKTIJDEN, ...(row.waarde as Partial<Werktijden>) }
    }
  }
  return { config, werktijden }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  let kwaliteit_code = ''
  let kleur_code = ''
  let lockAcquired = false

  try {
    // ---- Parse input ----
    const body = await req.json()
    kwaliteit_code = body.kwaliteit_code
    kleur_code = body.kleur_code
    const tot_datum = body.tot_datum ?? null

    if (!kwaliteit_code || !kleur_code) {
      return new Response(
        JSON.stringify({ error: 'kwaliteit_code en kleur_code zijn verplicht' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ---- Step 1: Acquire lock ----
    lockAcquired = await acquireLock(supabase, kwaliteit_code, kleur_code)
    if (!lockAcquired) {
      return new Response(
        JSON.stringify({
          skipped: true,
          reason: `Optimalisatie voor ${kwaliteit_code} / ${kleur_code} is al bezig`,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ---- Step 1b: Snapshot oude rol-toewijzing (Fase 2, vóór release) ----
    // "Vóór"-foto voor de verdringingscheck na het packen — moet vóór Step 2
    // gebeuren, anders is er na de release niets meer over om te snapshotten.
    const oudeToewijzingen = await fetchOudeRolToewijzingen(supabase, kwaliteit_code, kleur_code)

    // ---- Step 2: Release all Gepland stukken in this group ----
    const { data: releaseCount, error: releaseError } = await supabase.rpc(
      'release_gepland_stukken',
      { p_kwaliteit_code: kwaliteit_code, p_kleur_code: kleur_code },
    )
    if (releaseError) throw releaseError

    // ---- Step 2b: Release "Wacht op inkoop"-claims in deze groep (mig 438) ----
    // Zelfde release-dan-herberekenen-principe als Step 2 — voorkomt dat een
    // stale claim de tweede pas (Step 4b) blokkeert of een verkeerd
    // "resterend"-getal achterlaat op inkooporder_regels.
    const { error: releaseInkoopError } = await supabase.rpc(
      'release_wacht_op_inkoop_stukken',
      { p_kwaliteit_code: kwaliteit_code, p_kleur_code: kleur_code },
    )
    if (releaseInkoopError) throw releaseInkoopError

    // ---- Step 3: Fetch all Gepland stukken (including freshly released ones) ----
    // 'Wacht' meegenomen voor backwards-compat met legacy rows (zie migratie 069).
    // 'Gepland' = stukken die nog geen rol hebben of waarvan de rol niet gestart is.
    const pieces = await fetchStukken(supabase, {
      kwaliteitCode: kwaliteit_code,
      kleurCode: kleur_code,
      statuses: [...PLANBAAR],
      totDatum: tot_datum,
    })

    if (pieces.length === 0) {
      // No pieces to plan — release lock and return
      return new Response(
        JSON.stringify({
          skipped: true,
          reason: `Geen wachtende stukken voor ${kwaliteit_code} / ${kleur_code}`,
          released: releaseCount ?? 0,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ---- Step 4: Fetch available rolls + bezette plaatsingen ----
    // Eén bron-van-waarheid voor uitwisselbaarheid: de canonieke RPC
    // `uitwisselbare_paren()` (migraties 138/140). Resolver: zelfde
    // collectie_id + genormaliseerde kleur-code. Geen Map1 / fallback-cascade
    // meer — de UI tekort_analyse en deze edge zien gegarandeerd dezelfde set.
    const paren = await fetchUitwisselbareParen(supabase, kwaliteit_code, kleur_code)
    const rollen = await fetchBeschikbareRollen(supabase, paren, kwaliteit_code)

    // Geen early-return meer bij rollen.length === 0: stukken die hier geen
    // fysieke rol vinden krijgen straks (IO-claim-pas hieronder) nog een kans
    // tegen een openstaande rol-inkooporder. `packAcrossRolls` met een lege
    // rollen-array levert gewoon alle pieces terug in `nietGeplaatst`.

    // Bezette plaatsingen: al-gesneden Snijden-stukken op rollen die nog niet
    // in productie zijn → reconstructie van hun shelves zodat nieuwe stukken
    // in bestaande gaps kunnen landen i.p.v. een verse rol aan te snijden.
    const bezetteMap = await fetchBezettePlaatsingen(supabase, paren)

    // Max-afval-percentage voor reststukken (uit app_config). Als een reststuk
    // na packing meer verspilling zou opleveren, wordt die overgeslagen —
    // zo blijven kleine reststukken intact voor een betere gelegenheid.
    const { data: cfgRow } = await supabase
      .from('app_config')
      .select('waarde')
      .eq('sleutel', 'productie_planning')
      .maybeSingle()
    const cfgWaarde = (cfgRow?.waarde ?? {}) as Record<string, unknown>
    const maxReststukVerspillingPct =
      typeof cfgWaarde.max_reststuk_verspilling_pct === 'number'
        ? cfgWaarde.max_reststuk_verspilling_pct
        : 15

    // ---- Step 4b: FIFO-magazijnleeftijd-opties (ADR-0021) ----
    const fifo = await buildFifoOptions(supabase)

    // ---- Step 5: best-of-both packing (FIFO-bewust) ----
    const pieceVormMap = new Map<number, string | null>(
      pieces.map((p) => [p.id, p.maatwerk_vorm]),
    )
    const { rollResults, nietGeplaatst, samenvatting, fifoMetrics } = packAcrossRolls(
      pieces,
      rollen,
      pieceVormMap,
      { bezetteMap, maxReststukVerspillingPct, fifo },
    )

    // ---- Step 5b: Verdringingscheck (Fase 2, veiligheidsnet) ----
    // Een stuk dat vóór de release een echte rol had (oudeToewijzingen) maar
    // nu nergens in rollResults als geplaatst voorkomt is verdrongen — typisch
    // doordat een express-stuk voorrang kreeg (sortPieces). Belandt het stuk
    // straks via de IO-claim-pas alsnog in "Wacht op inkoop" i.p.v. op een
    // échte rol, dan telt dat óók als verdrongen: de fysieke snijbelofte is
    // hoe dan ook weg. Alleen relevant als het stuk daardoor zijn snij-
    // deadline zou missen — anders mag de heroptimalisatie gewoon doorgaan.
    const geplaatsteIds = new Set(
      rollResults.flatMap((r) => r.plaatsingen.map((p) => p.snijplan_id)),
    )
    let verdringingRisico = false
    const verdrongenOrders: Array<{ order_id: number; order_nr: string | null; snijplan_id: number; snijplan_nr: string | null }> = []
    const verdrongenKandidaten = [...oudeToewijzingen.entries()].filter(
      ([snijplanId]) => !geplaatsteIds.has(snijplanId),
    )
    if (verdrongenKandidaten.length > 0) {
      const { config: deadlineConfig, werktijden } = await fetchSnijDeadlineConfig(supabase)
      const vandaag = isoDatum(new Date())
      for (const [snijplanId, oude] of verdrongenKandidaten) {
        if (!oude.afleverdatum) continue
        const { status } = berekenHaalbaarheid(oude.afleverdatum, oude.leverType, deadlineConfig, werktijden, vandaag)
        if (status === 'rood') {
          verdringingRisico = true
          verdrongenOrders.push({
            order_id: oude.orderId,
            order_nr: oude.orderNr,
            snijplan_id: snijplanId,
            snijplan_nr: oude.snijplanNr,
          })
        }
      }
    }

    // ---- Step 6-8: Save voorstel + auto-approve + shelf-validator ----
    // Alleen relevant als er überhaupt iets op een échte rol geplaatst is;
    // bij 0 rollResults (bv. helemaal geen fysieke rollen) slaan we dit over
    // en gaat alles door naar de IO-claim-pas hieronder.
    let voorstel_id: number | undefined
    let voorstel_nr: string | undefined
    let fifoCarveOut = false
    let shelfWaarschuwingen: ReturnType<typeof validateShelfMesLimiet> = []

    if (rollResults.length > 0) {
      // Math.round: lengte_cm/breedte_cm op snijvoorstel_plaatsingen zijn INTEGER-
      // kolommen, maar p.lengte_cm/breedte_cm zijn de "placed" (marge-inclusieve)
      // afmetingen — sinds mig 455 (2,5cm vorm-marge) kan dat een fractie zijn
      // (bv. 242.5), wat een "invalid input syntax for type integer"-fout gaf.
      // Positie wordt ook afgerond voor consistentie met de rest van het systeem
      // (hele cm overal zichtbaar voor de gebruiker, zelfde principe als derive.ts).
      const plaatsingen = rollResults.flatMap((r) =>
        r.plaatsingen.map((p) => ({
          rol_id: r.rol_id,
          snijplan_id: p.snijplan_id,
          positie_x_cm: Math.round(p.positie_x_cm),
          positie_y_cm: Math.round(p.positie_y_cm),
          lengte_cm: Math.round(p.lengte_cm),
          breedte_cm: Math.round(p.breedte_cm),
          geroteerd: p.geroteerd,
        })),
      )

      const saved = await saveVoorstel(supabase, {
        kwaliteitCode: kwaliteit_code,
        kleurCode: kleur_code,
        totaalStukken: samenvatting.totaal_stukken,
        totaalRollen: samenvatting.totaal_rollen,
        totaalM2Gebruikt: samenvatting.totaal_m2_gebruikt,
        totaalM2Afval: samenvatting.totaal_m2_afval,
        afvalPercentage: samenvatting.gemiddeld_afval_pct,
        aangemaakt_door: 'systeem',
        fifo: fifoMetrics,
      }, plaatsingen)
      voorstel_id = saved.voorstel_id
      voorstel_nr = saved.voorstel_nr

      // Auto-approve — behalve bij rode FIFO-badge (ADR-0021) of verdringings-
      // risico (Fase 2). Rode FIFO-badge: de leeftijd-voorkeur kost fors extra
      // snijafval. Verdringingsrisico: een eerder gepland stuk verloor zijn rol
      // en zou zijn snij-deadline missen. Beide afwegingen laten we niet
      // automatisch goedkeuren: het voorstel blijft 'concept' voor handmatige
      // beoordeling. Geel/grijs zonder verdringing gaat normaal door.
      fifoCarveOut = fifoMetrics?.badge === 'rood'
      if (!fifoCarveOut && !verdringingRisico) {
        const { error: keurError } = await supabase.rpc(
          'keur_snijvoorstel_goed',
          { p_voorstel_id: voorstel_id },
        )
        if (keurError) throw keurError
      }

      // shelf-mes-validator (zacht: alleen rapporteren)
      shelfWaarschuwingen = validateShelfMesLimiet(
        rollResults.map((r) => ({
          rol_id: r.rol_id,
          rolnummer: r.rolnummer,
          rol_breedte_cm: r.rol_breedte_cm,
          plaatsingen: r.plaatsingen,
        })),
      )
      if (shelfWaarschuwingen.length > 0) {
        console.warn(
          `[auto-plan-groep] ${shelfWaarschuwingen.length} shelf(s) vereisen meer dan 3 breedte-messen:`,
          JSON.stringify(shelfWaarschuwingen),
        )
      }
    }

    // ---- IO-claim-pas (mig 437/438): stukken die nergens fysiek pasten ----
    // alsnog matchen tegen een openstaande rol-inkooporder (exacte kwaliteit,
    // FIFO op verwacht_datum). Virtuele rol bestaat alleen hier in-memory —
    // nooit een rij in `rollen` (zie plan: les uit de PH-placeholder-rollen-
    // afschaffing, mig 182).
    const nietGeplaatstIds = new Set(nietGeplaatst.map((np) => np.snijplan_id))
    const nietGeplaatstPieces: SnijplanPiece[] = pieces.filter((p) => nietGeplaatstIds.has(p.id))

    let wachtOpInkoop: {
      aantal_stukken: number
      regels: Array<{ inkooporder_nr: string; gebruikte_lengte_cm: number; te_leveren_cm: number; resterend_cm: number }>
    } | null = null
    let nietGeplaatstFinaal = nietGeplaatst

    if (nietGeplaatstPieces.length > 0) {
      const [openRegels, standaardBreedteCm] = await Promise.all([
        fetchOpenInkoopRegels(supabase, kwaliteit_code, kleur_code),
        fetchStandaardBreedte(supabase, kwaliteit_code),
      ])

      if (openRegels.length > 0 && standaardBreedteCm != null) {
        // Negatieve id = veilige in-memory marker (regel_id is altijd > 0),
        // nooit gepersisteerd — voorkomt botsing met echte rollen.id.
        const virtueleRollen: Roll[] = openRegels.map((r) => ({
          id: -r.regel_id,
          rolnummer: r.inkooporder_nr,
          lengte_cm: Math.round(r.te_leveren_m * 100),
          breedte_cm: standaardBreedteCm,
          status: 'verwacht',
          oppervlak_m2: Math.round(r.te_leveren_m * 100) * standaardBreedteCm / 10000,
          // 3 = altijd na reststuk(1)/beschikbaar(2) — echte voorraad gaat
          // hoe dan ook voor. sortRolls/sortRollsLargestFirst/makeSortRollsFifo
          // vergelijken sort_priority numeriek vóór leeftijd (geverifieerd).
          sort_priority: 3,
          is_exact: true,
          has_existing_placements: false,
          in_magazijn_sinds: null,
        }))

        const ioPieceVormMap = new Map<number, string | null>(
          nietGeplaatstPieces.map((p) => [p.id, p.maatwerk_vorm]),
        )
        const ioPak = packAcrossRolls(
          nietGeplaatstPieces,
          virtueleRollen,
          ioPieceVormMap,
          { bezetteMap: new Map(), maxReststukVerspillingPct },
        )

        if (ioPak.rollResults.length > 0) {
          const claims: Array<{ snijplan_id: number; inkooporder_regel_id: number }> = []
          const regelTotalen: Array<{ inkooporder_regel_id: number; gebruikte_lengte_cm: number }> = []
          const regelInfoMap = new Map(openRegels.map((r) => [r.regel_id, r]))
          const regels: Array<{ inkooporder_nr: string; gebruikte_lengte_cm: number; te_leveren_cm: number; resterend_cm: number }> = []

          for (const r of ioPak.rollResults) {
            const regelId = -r.rol_id
            for (const p of r.plaatsingen) {
              claims.push({ snijplan_id: p.snijplan_id, inkooporder_regel_id: regelId })
            }
            regelTotalen.push({ inkooporder_regel_id: regelId, gebruikte_lengte_cm: Math.round(r.gebruikte_lengte_cm) })

            const info = regelInfoMap.get(regelId)
            const teLeverenCm = Math.round((info?.te_leveren_m ?? 0) * 100)
            regels.push({
              inkooporder_nr: r.rolnummer,
              gebruikte_lengte_cm: Math.round(r.gebruikte_lengte_cm),
              te_leveren_cm: teLeverenCm,
              resterend_cm: Math.max(teLeverenCm - Math.round(r.gebruikte_lengte_cm), 0),
            })
          }

          const { data: aantalGeclaimd, error: claimError } = await supabase.rpc(
            'claim_wacht_op_inkoop',
            { p_claims: claims, p_regel_totalen: regelTotalen },
          )
          if (claimError) throw claimError

          wachtOpInkoop = { aantal_stukken: aantalGeclaimd ?? claims.length, regels }
          nietGeplaatstFinaal = ioPak.nietGeplaatst
        } else {
          nietGeplaatstFinaal = ioPak.nietGeplaatst
        }
      }
    }

    // ---- Build response ----
    if (rollResults.length === 0 && !wachtOpInkoop) {
      return new Response(
        JSON.stringify({
          skipped: true,
          reason: 'Geen stukken konden geplaatst worden op beschikbare rollen, en geen (of onvoldoende) openstaande inkoop voor deze kwaliteit',
          released: releaseCount ?? 0,
          wachtend: pieces.length,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const carveOutReasons: string[] = []
    if (fifoCarveOut) carveOutReasons.push('Rode FIFO-badge — leeftijd-voorkeur kost fors extra snijafval.')
    if (verdringingRisico) {
      carveOutReasons.push(
        `Verdringingsrisico — ${verdrongenOrders.length} eerder gepland stuk(ken) verloren hun rol en zouden hun snij-deadline missen.`,
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        voorstel_id: voorstel_id ?? null,
        voorstel_nr: voorstel_nr ?? null,
        released: releaseCount ?? 0,
        auto_approved: rollResults.length > 0 ? !fifoCarveOut && !verdringingRisico : null,
        ...(carveOutReasons.length > 0
          ? {
              reason: voorstel_id
                ? `${carveOutReasons.join(' ')} Voorstel blijft concept voor handmatige beoordeling.`
                : carveOutReasons.join(' '),
            }
          : {}),
        ...(verdrongenOrders.length > 0 ? { verdrongen_orders: verdrongenOrders } : {}),
        samenvatting: {
          ...samenvatting,
          shelf_waarschuwingen: shelfWaarschuwingen,
        },
        fifo: fifoMetrics ?? null,
        wacht_op_inkoop: wachtOpInkoop,
        niet_geplaatst: nietGeplaatstFinaal,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    let message: string
    let detail: string | undefined
    let hint: string | undefined
    let code: string | undefined
    if (err instanceof Error) {
      message = err.message
    } else if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>
      message = (e.message as string) ?? JSON.stringify(e)
      detail = e.details as string | undefined
      hint = e.hint as string | undefined
      code = e.code as string | undefined
    } else {
      message = String(err)
    }
    console.error('auto-plan-groep error:', { message, detail, hint, code, kwaliteit_code, kleur_code })

    return new Response(
      JSON.stringify({ error: `Auto-plan fout: ${message}`, detail, hint, code }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } finally {
    // Always release lock
    if (lockAcquired) {
      try {
        await releaseLock(supabase, kwaliteit_code, kleur_code)
      } catch (e) {
        console.error('Lock release failed:', e)
      }
    }
  }
})
