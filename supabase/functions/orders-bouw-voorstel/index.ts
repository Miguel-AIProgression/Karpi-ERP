import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Types (gedeeld met frontend via LevertijdSimulatieContract)
// ---------------------------------------------------------------------------

interface MaatwerkRegelConcept {
  regel_id: string
  kwaliteit_code: string
  kleur_code: string
  lengte_cm: number
  breedte_cm: number
  vorm?: string | null
  gewenste_leverdatum?: string | null
  debiteur_nr?: number | null
}

interface PerRegelScenario {
  regel_id: string
  scenario: string
  snij_datum: string | null
  lever_datum: string | null
  spoed_toeslag_bedrag: number | null
  onderbouwing: string
}

interface ConceptRegel {
  regel_id: string
  artikelnr: string
  aantal: number
  lengte_cm?: number | null
  breedte_cm?: number | null
  kwaliteit_code?: string | null
  kleur_code?: string | null
  vorm?: string | null
  maatwerk_afwerking?: string | null
  gewenste_leverdatum?: string | null
}

interface ConceptInput {
  debiteur_nr?: number | null
  regels: ConceptRegel[]
  uitwisselbaar_keuzes?: Array<{ regel_id: string; artikelnr: string; aantal: number }>
}

// ---------------------------------------------------------------------------
// Hulpfunctie: splits array in chunks van max `size`
// ---------------------------------------------------------------------------

function chunkArray<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size),
  )
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Alleen POST toegestaan' }, 405)
  }

  let body: { concept?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Ongeldige JSON body' }, 400)
  }

  const { concept } = body
  if (!concept || typeof concept !== 'object') {
    return jsonResponse({ error: 'concept is verplicht' }, 400)
  }

  const c = concept as ConceptInput
  if (!Array.isArray(c.regels) || c.regels.length === 0) {
    return jsonResponse({ error: 'concept.regels moet een niet-lege array zijn' }, 400)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  try {
    // ---- Stap 1: Aanroep bouw_order_voorstel RPC ----
    const { data, error } = await supabase.rpc('bouw_order_voorstel', { p_concept: concept })

    if (error) {
      console.error('bouw_order_voorstel RPC error:', error.message)
      return jsonResponse({ error: `DB-fout: ${error.message}` }, 500)
    }

    // ---- Stap 2: Extraheer maatwerk-regels (hebben lengte_cm en breedte_cm) ----
    const maatwerkRegels = c.regels.filter(
      (r) => r.lengte_cm != null && r.lengte_cm > 0 && r.breedte_cm != null && r.breedte_cm > 0,
    )

    if (maatwerkRegels.length === 0) {
      return jsonResponse(data, 200)
    }

    // ---- Stap 3: Batch maatwerk-regels in chunks van max 2 ----
    const batches = chunkArray(maatwerkRegels, 2)
    const planningUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/planning-simuleer-levertijd`

    // ---- Stap 4: Parallel aanroepen van planning-simuleer-levertijd per batch ----
    const planningResults = await Promise.all(
      batches.map(async (batch) => {
        const seamInput: MaatwerkRegelConcept[] = batch.map((r) => ({
          regel_id: r.regel_id,
          kwaliteit_code: r.kwaliteit_code ?? r.artikelnr.split('-')[0],
          kleur_code: r.kleur_code ?? (r.artikelnr.split('-')[1] ?? ''),
          lengte_cm: r.lengte_cm as number,
          breedte_cm: r.breedte_cm as number,
          vorm: r.vorm ?? null,
          gewenste_leverdatum: r.gewenste_leverdatum ?? null,
          debiteur_nr: c.debiteur_nr ?? null,
        }))

        try {
          const resp = await fetch(planningUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              'apikey': Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            },
            body: JSON.stringify({ regels: seamInput }),
          })

          if (!resp.ok) {
            const errText = await resp.text().catch(() => '')
            console.error(`planning-simuleer-levertijd HTTP ${resp.status}:`, errText)
            return {
              ok: false as const,
              error: 'planning_unavailable' as const,
              message: `Planning HTTP ${resp.status}`,
            }
          }

          const json = await resp.json()
          if (Array.isArray(json.scenarios)) {
            return { ok: true as const, scenarios: json.scenarios as PerRegelScenario[] }
          }
          return {
            ok: false as const,
            error: 'planning_unavailable' as const,
            message: json.error ?? 'Onverwacht planning-antwoord',
          }
        } catch (fetchErr) {
          const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
          console.error('planning-fetch fout:', msg)
          return {
            ok: false as const,
            error: 'planning_unavailable' as const,
            message: `Planning-fetch fout: ${msg}`,
          }
        }
      }),
    )

    // ---- Stap 5: Merge scenarios in voorstel-resultaat ----
    const scenarioMap = new Map<string, PerRegelScenario>()
    for (const result of planningResults) {
      if (result.ok) {
        for (const s of result.scenarios) {
          scenarioMap.set(s.regel_id, s)
        }
      }
    }

    // Bouw set van alle maatwerk regel_ids voor planning_beschikbaar-check
    const maatwerkIds = new Set(maatwerkRegels.map((r) => r.regel_id))

    const uitvoer = {
      ...(data as Record<string, unknown>),
      regels: (
        (data as Record<string, unknown>).regels as Array<Record<string, unknown>>
      ).map((r) => {
        const regelId = r.regel_id as string
        if (!maatwerkIds.has(regelId)) {
          // Niet-maatwerk regels: planning niet van toepassing
          return { ...r, planning_scenario: null, planning_beschikbaar: false }
        }
        const scenario = scenarioMap.get(regelId) ?? null
        return {
          ...r,
          planning_scenario: scenario,
          planning_beschikbaar: scenario !== null,
        }
      }),
    }

    return jsonResponse(uitvoer, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('orders-bouw-voorstel error:', message)
    return jsonResponse({ error: `Onverwachte fout: ${message}` }, 500)
  }
})
