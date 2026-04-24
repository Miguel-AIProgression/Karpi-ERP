// Supabase Edge Function: optimaliseer-snijplan
// 2D strip-packing voor optimale plaatsing van tapijt-stukken op rollen.
// Gebruikt de best-of-both strategie (Guillotine + FFDH per rol) uit
// _shared/guillotine-packing.ts — zie daar voor algoritme-details.
//
// Tabellen: snijvoorstellen, snijvoorstel_plaatsingen, rollen
// View: snijplanning_overzicht

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { packAcrossRolls } from '../_shared/guillotine-packing.ts'
import { computeReststukken } from '../_shared/compute-reststukken.ts'
import { calcRollStats } from '../_shared/ffdh-packing.ts'
import { validateShelfMesLimiet } from '../_shared/shelf-mes-validator.ts'
import {
  fetchStukken,
  fetchUitwisselbareCodes,
  fetchUitwisselbarePairs,
  getKleurVariants,
  fetchBeschikbareRollen,
  saveVoorstel,
} from '../_shared/db-helpers.ts'

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ---- Auth & client setup ----
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // ---- Parse & validate input ----
    const { kwaliteit_code, kleur_code, tot_datum } = await req.json()

    if (!kwaliteit_code || !kleur_code) {
      return new Response(
        JSON.stringify({
          error: 'kwaliteit_code en kleur_code zijn verplicht',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ---- Step 1: Fetch waiting snijplannen via the view ----
    const pieces = await fetchStukken(supabase, {
      kwaliteitCode: kwaliteit_code,
      kleurCode: kleur_code,
      statuses: ['Wacht'],
      totDatum: tot_datum ?? null,
    })

    if (pieces.length === 0) {
      return new Response(
        JSON.stringify({
          error: `Geen wachtende snijplannen gevonden voor ${kwaliteit_code} / ${kleur_code}`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ---- Step 1b: Find interchangeable (kwaliteit,kleur)-pairs ----
    //   Primair: fijnmazige Map1-tabel. Fallback: collecties. Als Map1 pairs
    //   oplevert die geen voorraad hebben, vallen we alsnog terug op de brede
    //   collectie-set (zelfde pad als tekort_analyse in UI) — anders ziet de
    //   edge function minder voorraad dan de UI en blijft een groep hangen.
    let uitwisselbarePairs = await fetchUitwisselbarePairs(supabase, kwaliteit_code, kleur_code)
    let uitwisselbareCodes = uitwisselbarePairs.length > 0
      ? Array.from(new Set(uitwisselbarePairs.map((p) => p.kwaliteit_code)))
      : await fetchUitwisselbareCodes(supabase, kwaliteit_code)

    // ---- Step 1c: Fetch available rolls ----
    const kleurVariants = getKleurVariants(kleur_code)
    let rollen = await fetchBeschikbareRollen(
      supabase,
      uitwisselbareCodes,
      kleurVariants,
      kwaliteit_code,
      uitwisselbarePairs,
    )

    if (rollen.length === 0 && uitwisselbarePairs.length > 0) {
      uitwisselbarePairs = []
      uitwisselbareCodes = await fetchUitwisselbareCodes(supabase, kwaliteit_code)
      rollen = await fetchBeschikbareRollen(
        supabase,
        uitwisselbareCodes,
        kleurVariants,
        kwaliteit_code,
      )
    }

    if (rollen.length === 0) {
      return new Response(
        JSON.stringify({
          error: `Geen beschikbare rollen voor ${kwaliteit_code} ${kleur_code}` +
            (uitwisselbareCodes.length > 1
              ? ` (ook gezocht: ${uitwisselbareCodes.filter(c => c !== kwaliteit_code).join(', ')})`
              : ''),
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ---- Step 2: Build vorm map for area calculations ----
    const pieceVormMap = new Map<number, string | null>(
      pieces.map((p) => [p.id, p.maatwerk_vorm]),
    )

    // ---- Step 3: best-of-both packing across rolls ----
    const { rollResults, nietGeplaatst, samenvatting } = packAcrossRolls(pieces, rollen, pieceVormMap)

    // ---- Step 3b: Vul-op fase — voeg stukken buiten horizon toe op bestaande rollen ----
    // Als tot_datum gezet is en er al rollen gepakt zijn, probeer stukken met
    // een latere leverdatum op die rollen te passen zodat de rol zoveel mogelijk
    // opgesneden wordt. Er worden GEEN nieuwe rollen geopend in deze fase.
    let buiten_scope_ids: number[] = []

    if (tot_datum && rollResults.length > 0) {
      const fillUpPieces = await fetchStukken(supabase, {
        kwaliteitCode: kwaliteit_code,
        kleurCode: kleur_code,
        statuses: ['Wacht'],
        vanDatum: tot_datum,
      })

      if (fillUpPieces.length > 0) {
        const primaryIds = new Set(pieces.map((p) => p.id))
        const extraPieces = fillUpPieces.filter((p) => !primaryIds.has(p.id))

        if (extraPieces.length > 0) {
          const extraVormMap = new Map<number, string | null>(
            extraPieces.map((p) => [p.id, p.maatwerk_vorm ?? null]),
          )
          // bezetteMap voor fase 2: fase-1 plaatsingen per rol
          const fillBezetteMap = new Map<number, typeof rollResults[0]['plaatsingen']>(
            rollResults.map((r) => [r.rol_id, r.plaatsingen]),
          )
          // Alleen rollen die al in fase 1 gebruikt zijn (geen nieuwe rollen openen)
          const usedRolIds = new Set(rollResults.map((r) => r.rol_id))
          const fillRollen = rollen.filter((r) => usedRolIds.has(r.id))

          const fillResult = packAcrossRolls(extraPieces, fillRollen, extraVormMap, {
            bezetteMap: fillBezetteMap,
          })

          buiten_scope_ids = fillResult.rollResults.flatMap((r) =>
            r.plaatsingen.map((p) => p.snijplan_id),
          )

          if (buiten_scope_ids.length > 0) {
            // Merge fill-up plaatsingen in bestaande rollResults + herbereken stats
            const combinedVormMap = new Map([...pieceVormMap, ...extraVormMap])
            for (const fr of fillResult.rollResults) {
              const existing = rollResults.find((r) => r.rol_id === fr.rol_id)
              if (!existing) continue
              const allPlaats = [...existing.plaatsingen, ...fr.plaatsingen]
              existing.plaatsingen = allPlaats
              const stats = calcRollStats(allPlaats, existing.rol_breedte_cm, existing.rol_lengte_cm, combinedVormMap)
              existing.gebruikte_lengte_cm = stats.gebruikte_lengte_cm
              existing.afval_percentage = stats.afval_percentage
              existing.restlengte_cm = stats.restlengte_cm
            }
            samenvatting.totaal_stukken += buiten_scope_ids.length
            samenvatting.geplaatst += buiten_scope_ids.length
          }
        }
      }
    }

    // ---- Step 4: Save to database ----
    const plaatsingen = rollResults.flatMap((r) =>
      r.plaatsingen.map((p) => ({
        rol_id: r.rol_id,
        snijplan_id: p.snijplan_id,
        positie_x_cm: p.positie_x_cm,
        positie_y_cm: p.positie_y_cm,
        lengte_cm: p.lengte_cm,
        breedte_cm: p.breedte_cm,
        geroteerd: p.geroteerd,
      })),
    )

    const { voorstel_id, voorstel_nr } = await saveVoorstel(supabase, {
      kwaliteitCode: kwaliteit_code,
      kleurCode: kleur_code,
      totaalStukken: samenvatting.totaal_stukken,
      totaalRollen: samenvatting.totaal_rollen,
      totaalM2Gebruikt: samenvatting.totaal_m2_gebruikt,
      totaalM2Afval: samenvatting.totaal_m2_afval,
      afvalPercentage: samenvatting.gemiddeld_afval_pct,
    }, plaatsingen)

    // ---- Step 5: Verrijk elke rol met bruikbare reststukken ----
    const rollenMetReststukken = rollResults.map((r) => ({
      ...r,
      reststukken: computeReststukken(r.rol_lengte_cm, r.rol_breedte_cm, r.plaatsingen),
    }))

    // ---- Step 6: shelf-mes-validator — waarschuw als een rij meer dan 3
    //             breedte-mes-posities nodig heeft (machine heeft er maar 3).
    //             Zachte check: alleen rapporteren, niet afwijzen.
    const shelfWaarschuwingen = validateShelfMesLimiet(
      rollResults.map((r) => ({
        rol_id: r.rol_id,
        rolnummer: r.rolnummer,
        rol_breedte_cm: r.rol_breedte_cm,
        plaatsingen: r.plaatsingen,
      })),
    )
    if (shelfWaarschuwingen.length > 0) {
      console.warn(
        `[optimaliseer-snijplan] ${shelfWaarschuwingen.length} shelf(s) vereisen meer dan 3 breedte-messen:`,
        JSON.stringify(shelfWaarschuwingen),
      )
    }

    // ---- Build response ----
    const result = {
      voorstel_id,
      voorstel_nr,
      rollen: rollenMetReststukken,
      niet_geplaatst: nietGeplaatst,
      buiten_scope_ids,
      samenvatting: {
        ...samenvatting,
        shelf_waarschuwingen: shelfWaarschuwingen,
      },
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('optimaliseer-snijplan error:', message)

    return new Response(
      JSON.stringify({ error: `Interne fout: ${message}` }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
