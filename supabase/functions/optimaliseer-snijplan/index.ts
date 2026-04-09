// Supabase Edge Function: optimaliseer-snijplan
// FFDH (First Fit Decreasing Height) 2D strip-packing algorithm
// for optimal placement of carpet pieces on rolls.
//
// Expects tables: snijvoorstellen, snijvoorstel_plaatsingen
// Uses view: snijplanning_overzicht
// Uses table: rollen

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { packAcrossRolls } from '../_shared/ffdh-packing.ts'
import {
  fetchStukken,
  fetchUitwisselbareCodes,
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

    // ---- Step 1b: Find interchangeable quality codes via collecties ----
    const uitwisselbareCodes = await fetchUitwisselbareCodes(supabase, kwaliteit_code)

    // ---- Step 1c: Fetch available rolls (exact + interchangeable) ----
    const kleurVariants = getKleurVariants(kleur_code)
    const rollen = await fetchBeschikbareRollen(supabase, uitwisselbareCodes, kleurVariants, kwaliteit_code)

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

    // ---- Step 3: FFDH packing across rolls ----
    const { rollResults, nietGeplaatst, samenvatting } = packAcrossRolls(pieces, rollen, pieceVormMap)

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

    // ---- Build response ----
    const result = {
      voorstel_id,
      voorstel_nr,
      rollen: rollResults,
      niet_geplaatst: nietGeplaatst,
      samenvatting,
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
