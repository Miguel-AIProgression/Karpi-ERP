// Supabase Edge Function: schat-benodigde-lengte
//
// Puur LEZEND endpoint: schat hoeveel rol-lengte (cm) nodig is om de huidige
// Tekort-stukken van één kwaliteit+kleur-groep te snijden, via de echte
// guillotine-packer (niet een platte m²-som — stukken kunnen naast elkaar op
// de rolbreedte gesneden worden). Bewust LOS van `auto-plan-groep`: die
// muteert altijd (release/save/approve/claim); dit endpoint mag geen enkele
// schrijfactie doen, dus geen lock, geen release, geen voorstel, geen claim.
//
// Vraag die beantwoord wordt: "als ik nu één nieuwe rol van de standaard-
// breedte zou inkopen, hoe lang moet die zijn om precies de huidige
// Tekort-stukken (rol_id IS NULL) van deze kwaliteit+kleur te snijden?"
//
// De virtuele rol bestaat alleen hier in-memory (zelfde patroon als de
// "Wacht op inkoop"-claim, mig 437-445) — nooit een rij in `rollen`.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { packAcrossRolls } from '../_shared/guillotine-packing.ts'
import type { Roll } from '../_shared/ffdh-packing.ts'
import { fetchStukken, fetchStandaardBreedte } from '../_shared/db-helpers.ts'
import { PLANBAAR } from '../_shared/snijplan-status.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  try {
    const body = await req.json()
    const kwaliteit_code = body.kwaliteit_code as string
    const kleur_code = body.kleur_code as string

    if (!kwaliteit_code || !kleur_code) {
      return new Response(
        JSON.stringify({ error: 'kwaliteit_code en kleur_code zijn verplicht' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // `fetchStukken` filtert al op `rol_id IS NULL` — exact de stukken die nu
    // in de Tekort-lijst staan voor deze groep (PLANBAAR = Gepland/Wacht).
    const [pieces, standaardBreedteCm] = await Promise.all([
      fetchStukken(supabase, { kwaliteitCode: kwaliteit_code, kleurCode: kleur_code, statuses: [...PLANBAAR] }),
      fetchStandaardBreedte(supabase, kwaliteit_code),
    ])

    if (pieces.length === 0) {
      return new Response(
        JSON.stringify({ kan_berekenen: false, reden: `Geen tekort-stukken voor ${kwaliteit_code} / ${kleur_code}` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (standaardBreedteCm == null) {
      return new Response(
        JSON.stringify({
          kan_berekenen: false,
          reden: `Geen standaard rolbreedte bekend voor kwaliteit ${kwaliteit_code}`,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Ruime, altijd-toereikende bovengrens voor de virtuele rol-lengte: de som
    // van BEIDE afmetingen van elk stuk. Garandeert dat de packer nooit "vol"
    // raakt — het werkelijke resultaat (`gebruikte_lengte_cm`) wordt dus puur
    // door de stukken zelf bepaald, niet door deze canvas-grootte.
    const bovengrensLengteCm =
      pieces.reduce((sum, p) => sum + p.lengte_cm + p.breedte_cm, 0) + 1000

    const virtueleRol: Roll = {
      id: -1,
      rolnummer: `Nieuwe rol (${standaardBreedteCm}cm breed)`,
      lengte_cm: bovengrensLengteCm,
      breedte_cm: standaardBreedteCm,
      status: 'verwacht',
      oppervlak_m2: (bovengrensLengteCm * standaardBreedteCm) / 10000,
      sort_priority: 1,
      is_exact: true,
      has_existing_placements: false,
      in_magazijn_sinds: null,
    }

    const pieceVormMap = new Map<number, string | null>(pieces.map((p) => [p.id, p.maatwerk_vorm]))
    const { rollResults, nietGeplaatst } = packAcrossRolls(pieces, [virtueleRol], pieceVormMap, {})

    const rol = rollResults[0]

    return new Response(
      JSON.stringify({
        kan_berekenen: true,
        benodigde_lengte_cm: rol ? Math.round(rol.gebruikte_lengte_cm) : 0,
        benodigde_m2: rol ? Math.round((rol.gebruikte_lengte_cm * standaardBreedteCm) / 100) / 100 : 0,
        standaard_breedte_cm: standaardBreedteCm,
        afval_percentage: rol ? rol.afval_percentage : 0,
        aantal_stukken: pieces.length - nietGeplaatst.length,
        aantal_niet_passend: nietGeplaatst.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('schat-benodigde-lengte error:', message)
    return new Response(
      JSON.stringify({ error: `Schatting faalde: ${message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
