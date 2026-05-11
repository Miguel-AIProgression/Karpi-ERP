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
import { validateShelfMesLimiet } from '../_shared/shelf-mes-validator.ts'
import {
  fetchStukken,
  fetchUitwisselbareParen,
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

    // ---- Step 1b: Uitwissel-paren via canonieke RPC ----
    //   Eén bron-van-waarheid (migraties 138/140): zelfde collectie_id +
    //   genormaliseerde kleur-code. Self-row gegarandeerd inbegrepen.
    const paren = await fetchUitwisselbareParen(supabase, kwaliteit_code, kleur_code)

    // ---- Step 1c: Fetch available rolls ----
    const rollen = await fetchBeschikbareRollen(supabase, paren, kwaliteit_code)

    if (rollen.length === 0) {
      const partners = paren
        .filter((p) => !p.is_zelf)
        .map((p) => p.kwaliteit_code)
        .filter((c, i, a) => a.indexOf(c) === i)
      return new Response(
        JSON.stringify({
          error: `Geen beschikbare rollen voor ${kwaliteit_code} ${kleur_code}` +
            (partners.length > 0
              ? ` (ook gezocht: ${partners.join(', ')})`
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
