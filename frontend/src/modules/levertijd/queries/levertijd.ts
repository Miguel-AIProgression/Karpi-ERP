// Levertijd-Module — pure fetch-functies voor de twee publieke RPC's
// `levertijd_fit_check` en `levertijd_snelste_haalbaar` (mig 277) plus de
// status-uitlees-helper voor `orders.levertijd_status` (mig 276).
//
// React Query (caching, debounce, enabled-gating) leeft één laag hoger in
// `../hooks/`; deze module-boundary blijft puur transport. Conform het
// Reservering-precedent (`modules/reserveringen/queries/reserveringen.ts`).

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  FitCheckResultaat,
  LevertijdStatus,
  SnelsteHaalbaarResultaat,
} from '../types'

export interface LevertijdStatusRow {
  levertijd_status: LevertijdStatus | null
  standaard_afleverdatum_berekend: string | null
  afleverdatum: string | null
}

/**
 * Fit-check per regel: kan de gewenste ISO-week ('YYYY-Www') gehaald worden?
 * Roept `levertijd_fit_check(p_regel_ids, p_gewenste_week)` aan. Lege input-
 * array → returnt `[]` zonder DB-call, zodat callers geen guard nodig hebben.
 */
export async function fetchFitCheck(
  supabase: SupabaseClient,
  regelIds: number[],
  gewensteWeek: string,
): Promise<FitCheckResultaat[]> {
  if (regelIds.length === 0) return []
  const { data, error } = await supabase.rpc('levertijd_fit_check', {
    p_regel_ids: regelIds,
    p_gewenste_week: gewensteWeek,
  })
  if (error) throw error
  return (data ?? []) as FitCheckResultaat[]
}

/**
 * Snelste-haalbaar per regel: wat is de eerstvolgende ISO-week waarop deze
 * regel geleverd kan worden, los van klant-standaard? Roept
 * `levertijd_snelste_haalbaar(p_regel_ids)` aan. Lege input → `[]`.
 */
export async function fetchSnelsteHaalbaar(
  supabase: SupabaseClient,
  regelIds: number[],
): Promise<SnelsteHaalbaarResultaat[]> {
  if (regelIds.length === 0) return []
  const { data, error } = await supabase.rpc('levertijd_snelste_haalbaar', {
    p_regel_ids: regelIds,
  })
  if (error) throw error
  return (data ?? []) as SnelsteHaalbaarResultaat[]
}

/**
 * Leest het orders-niveau levertijd-label + snapshot voor badge-rendering.
 * Trigger uit mig 276 deriveert `levertijd_status` automatisch uit
 * `afleverdatum` vs `standaard_afleverdatum_berekend`; deze query leest
 * gewoon de drie kolommen tegelijk.
 */
export async function fetchLevertijdStatus(
  supabase: SupabaseClient,
  orderId: number,
): Promise<LevertijdStatusRow> {
  const { data, error } = await supabase
    .from('orders')
    .select('levertijd_status, standaard_afleverdatum_berekend, afleverdatum')
    .eq('id', orderId)
    .single()
  if (error) throw error
  const row = data as {
    levertijd_status: LevertijdStatus | null
    standaard_afleverdatum_berekend: string | null
    afleverdatum: string | null
  }
  return {
    levertijd_status: row.levertijd_status ?? null,
    standaard_afleverdatum_berekend: row.standaard_afleverdatum_berekend ?? null,
    afleverdatum: row.afleverdatum ?? null,
  }
}
