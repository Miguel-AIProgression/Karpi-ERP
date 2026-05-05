// Wrapper rond de `planning-simuleer-levertijd` edge function.
//
// Vangt alle exceptions op en retourneert altijd een `SeamResult`.
// Geen enkele fout propagateert over de seam als thrown exception.

import { supabase } from '@/lib/supabase/client'
import type { MaatwerkRegelConcept, SeamResult } from './levertijd-simulatie-contract'

// ---------------------------------------------------------------------------
// Edge-function interface (intern, niet geëxporteerd)
// ---------------------------------------------------------------------------

interface EdgeFunctionRequest {
  regels: MaatwerkRegelConcept[]
}

// ---------------------------------------------------------------------------
// Publieke seam-functie
// ---------------------------------------------------------------------------

/**
 * Simuleer levertijden voor een lijst maatwerk-regelconcepten.
 *
 * Roept de edge function `planning-simuleer-levertijd` aan en normaliseert
 * het resultaat tot een `SeamResult`. Gooit nooit een exception — alle
 * fouten zijn gecodeerd als `{ ok: false, ... }`.
 */
export async function simuleerLevertijd(
  maatwerkRegels: MaatwerkRegelConcept[],
): Promise<SeamResult> {
  if (maatwerkRegels.length === 0) {
    return { ok: false, error: 'invalid_input', message: 'Geen regels opgegeven.' }
  }

  try {
    const body: EdgeFunctionRequest = { regels: maatwerkRegels }
    const { data, error } = await supabase.functions.invoke('planning-simuleer-levertijd', {
      body,
    })

    if (error) {
      // Probeer een rijker foutbericht te extraheren uit de response-body.
      let message = error.message ?? 'Onbekende fout van planningsmodule.'
      try {
        const ctx = (error as Record<string, unknown>).context as Response | undefined
        if (ctx?.json) {
          const parsed = await ctx.json()
          if (typeof parsed?.error === 'string') message = parsed.error
          else if (typeof parsed?.message === 'string') message = parsed.message
        }
      } catch {
        // Fallback: gebruik het originele foutbericht.
      }
      return { ok: false, error: 'planning_unavailable', message }
    }

    if (!data || !Array.isArray(data.scenarios)) {
      return {
        ok: false,
        error: 'planning_unavailable',
        message: 'Onverwacht antwoordformaat van planningsmodule.',
      }
    }

    return { ok: true, scenarios: data.scenarios }
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Verbindingsfout met planningsmodule.'
    return { ok: false, error: 'planning_unavailable', message }
  }
}
