// Supabase Edge Function: auto-plan-groep
// Automatische snijplanning: release gepland → heroptimaliseer → auto-approve
//
// Orchestreert het volledige auto-plan proces voor één kwaliteit/kleur groep:
// 1. Lock verkrijgen (race condition preventie)
// 2. Gepland stukken vrijgeven
// 3. Alle Wacht/Gepland stukken ophalen + best-of-both packing
//    (Guillotine + FFDH per rol, kies beste — zie guillotine-packing.ts)
// 4. Voorstel opslaan + automatisch goedkeuren
// 5. Lock vrijgeven

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { packAcrossRolls } from '../_shared/guillotine-packing.ts'
import { validateShelfMesLimiet } from '../_shared/shelf-mes-validator.ts'
import {
  fetchStukken,
  fetchUitwisselbareParen,
  fetchBeschikbareRollen,
  fetchBezettePlaatsingen,
  saveVoorstel,
} from '../_shared/db-helpers.ts'

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

    // ---- Step 2: Release all Gepland stukken in this group ----
    const { data: releaseCount, error: releaseError } = await supabase.rpc(
      'release_gepland_stukken',
      { p_kwaliteit_code: kwaliteit_code, p_kleur_code: kleur_code },
    )
    if (releaseError) throw releaseError

    // ---- Step 3: Fetch all Gepland stukken (including freshly released ones) ----
    // 'Wacht' meegenomen voor backwards-compat met legacy rows (zie migratie 069).
    // 'Gepland' = stukken die nog geen rol hebben of waarvan de rol niet gestart is.
    const pieces = await fetchStukken(supabase, {
      kwaliteitCode: kwaliteit_code,
      kleurCode: kleur_code,
      statuses: ['Gepland', 'Wacht'],
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

    if (rollen.length === 0) {
      return new Response(
        JSON.stringify({
          skipped: true,
          reason: `Geen beschikbare rollen voor ${kwaliteit_code} / ${kleur_code}`,
          released: releaseCount ?? 0,
          wachtend: pieces.length,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

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

    // ---- Step 5: best-of-both packing ----
    const pieceVormMap = new Map<number, string | null>(
      pieces.map((p) => [p.id, p.maatwerk_vorm]),
    )
    const { rollResults, nietGeplaatst, samenvatting } = packAcrossRolls(
      pieces,
      rollen,
      pieceVormMap,
      { bezetteMap, maxReststukVerspillingPct },
    )

    if (rollResults.length === 0) {
      return new Response(
        JSON.stringify({
          skipped: true,
          reason: 'Geen stukken konden geplaatst worden op beschikbare rollen',
          released: releaseCount ?? 0,
          wachtend: pieces.length,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ---- Step 6: Save voorstel ----
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
      aangemaakt_door: 'systeem',
    }, plaatsingen)

    // ---- Step 7: Auto-approve via existing RPC ----
    const { error: keurError } = await supabase.rpc(
      'keur_snijvoorstel_goed',
      { p_voorstel_id: voorstel_id },
    )
    if (keurError) throw keurError

    // ---- Step 8: shelf-mes-validator (zacht: alleen rapporteren) ----
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
        `[auto-plan-groep] ${shelfWaarschuwingen.length} shelf(s) vereisen meer dan 3 breedte-messen:`,
        JSON.stringify(shelfWaarschuwingen),
      )
    }

    // ---- Build response ----
    return new Response(
      JSON.stringify({
        success: true,
        voorstel_id,
        voorstel_nr,
        released: releaseCount ?? 0,
        samenvatting: {
          ...samenvatting,
          shelf_waarschuwingen: shelfWaarschuwingen,
        },
        niet_geplaatst: nietGeplaatst,
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
