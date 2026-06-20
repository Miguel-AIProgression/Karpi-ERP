// Supabase Edge Function: wijs-snijplan-handmatig-toe
//
// Fase 4: een planner wijst één snijplan-stuk handmatig toe aan (of verplaatst
// het naar) een specifieke rol. Deze functie bezit de positiebepaling (via de
// bestaande pure packing-helpers `reconstructShelves`/`tryPlacePiece`, dezelfde
// shelf-logica als `auto-plan-groep`/`schat-benodigde-lengte`); de atomaire
// schrijfactie + vergrendeling (`is_handmatig_toegewezen=true`) zit in de RPC
// `wijs_snijplan_handmatig_toe` (mig 453). Vindt geen plek → geen mutatie,
// duidelijke foutmelding zodat de planner een andere rol kan kiezen.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { reconstructShelves, tryPlacePiece } from '../_shared/ffdh-packing.ts'
import type { Placement, SnijplanPiece } from '../_shared/ffdh-packing.ts'

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
    const snijplan_id = Number(body.snijplan_id)
    const rol_id = Number(body.rol_id)

    if (!snijplan_id || !rol_id) {
      return new Response(
        JSON.stringify({ error: 'snijplan_id en rol_id zijn verplicht' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Stuk-afmetingen incl. snij-marge (placed_*) — zelfde kolommen als fetchStukken.
    const { data: stukRow, error: stukError } = await supabase
      .from('snijplanning_overzicht')
      .select('id, placed_lengte_cm, placed_breedte_cm, maatwerk_vorm')
      .eq('id', snijplan_id)
      .maybeSingle()
    if (stukError) throw stukError
    if (!stukRow) {
      return new Response(
        JSON.stringify({ success: false, reason: `Snijplan ${snijplan_id} niet gevonden` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const piece: SnijplanPiece = {
      id: stukRow.id as number,
      lengte_cm: stukRow.placed_lengte_cm as number,
      breedte_cm: stukRow.placed_breedte_cm as number,
      maatwerk_vorm: stukRow.maatwerk_vorm as string | null,
      order_nr: null,
      klant_naam: null,
      afleverdatum: null,
      area_cm2: (stukRow.placed_lengte_cm as number) * (stukRow.placed_breedte_cm as number),
      express: false,
    }

    // Doelrol-afmetingen.
    const { data: rolRow, error: rolError } = await supabase
      .from('rollen')
      .select('id, breedte_cm, lengte_cm')
      .eq('id', rol_id)
      .maybeSingle()
    if (rolError) throw rolError
    if (!rolRow) {
      return new Response(
        JSON.stringify({ success: false, reason: `Rol ${rol_id} niet gevonden` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Bestaande plaatsingen op de doelrol (status='Gepland'), exclusief het
    // eigen stuk als het daar toevallig al stond (verplaatsen binnen dezelfde rol).
    const { data: bestaandeRows, error: plaatsingenError } = await supabase
      .from('snijplannen')
      .select('id, positie_x_cm, positie_y_cm, lengte_cm, breedte_cm, geroteerd')
      .eq('rol_id', rol_id)
      .eq('status', 'Gepland')
      .not('positie_x_cm', 'is', null)
      .not('positie_y_cm', 'is', null)
      .neq('id', snijplan_id)
    if (plaatsingenError) throw plaatsingenError

    const plaatsingen: Placement[] = (bestaandeRows ?? []).map((row: Record<string, unknown>) => {
      const geroteerd = (row.geroteerd as boolean) ?? false
      return {
        snijplan_id: row.id as number,
        positie_x_cm: Number(row.positie_x_cm),
        positie_y_cm: Number(row.positie_y_cm),
        lengte_cm: geroteerd ? Number(row.breedte_cm) : Number(row.lengte_cm),
        breedte_cm: geroteerd ? Number(row.lengte_cm) : Number(row.breedte_cm),
        geroteerd,
      }
    })

    const rolBreedteCm = rolRow.breedte_cm as number
    const rolLengteCm = rolRow.lengte_cm as number
    const shelves = reconstructShelves(plaatsingen, rolBreedteCm)
    const placement = tryPlacePiece(piece, shelves, rolBreedteCm, rolLengteCm, [])

    if (!placement) {
      return new Response(
        JSON.stringify({ success: false, reason: 'Stuk past niet op deze rol' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc('wijs_snijplan_handmatig_toe', {
      p_snijplan_id: snijplan_id,
      p_rol_id: rol_id,
      p_positie_x_cm: placement.positie_x_cm,
      p_positie_y_cm: placement.positie_y_cm,
      p_geroteerd: placement.geroteerd,
    })
    if (rpcError) throw rpcError

    const groep = (rpcData ?? [])[0] as { kwaliteit_code: string; kleur_code: string } | undefined

    return new Response(
      JSON.stringify({
        success: true,
        positie_x_cm: placement.positie_x_cm,
        positie_y_cm: placement.positie_y_cm,
        geroteerd: placement.geroteerd,
        kwaliteit_code: groep?.kwaliteit_code ?? null,
        kleur_code: groep?.kleur_code ?? null,
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
    console.error('wijs-snijplan-handmatig-toe error:', { message, detail, hint, code })
    return new Response(
      JSON.stringify({ error: `Handmatig toewijzen mislukt: ${message}`, detail, hint, code }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
