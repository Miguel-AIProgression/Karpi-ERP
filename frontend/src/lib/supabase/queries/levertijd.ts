// Wrapper rond de check-levertijd edge function.
// Houdt request/response shape gesynchroniseerd met
// supabase/functions/_shared/levertijd-types.ts.

import { supabase } from '../client'

export type LevertijdScenario =
  | 'match_bestaande_rol'
  | 'nieuwe_rol_gepland'
  | 'wacht_op_orders'
  | 'spoed'

export interface CheckLevertijdRequest {
  kwaliteit_code: string
  kleur_code: string
  lengte_cm: number
  breedte_cm: number
  vorm?: 'rechthoek' | 'rond' | string
  gewenste_leverdatum?: string | null
  debiteur_nr?: number | null
}

export interface MatchRolDetails {
  rol_id: number
  rolnummer: string
  snij_datum: string
  kwaliteit_match: 'exact' | 'uitwisselbaar'
}

export interface CapaciteitDetails {
  week: number
  jaar: number
  ruimte_stuks: number
  max_stuks: number
  huidig_stuks: number
}

export interface BacklogDetails {
  totaal_m2: number
  aantal_stukken: number
  drempel_m2: number
}

export interface LevertijdDetails {
  match_rol?: MatchRolDetails
  capaciteit?: CapaciteitDetails
  backlog?: BacklogDetails
  spoed?: boolean
  logistieke_buffer_dagen: number
}

export interface SpoedDetails {
  beschikbaar: boolean
  scenario: 'spoed_deze_week' | 'spoed_volgende_week' | 'spoed_geen_plek'
  snij_datum: string | null
  lever_datum: string | null
  week: number | null
  jaar: number | null
  week_restruimte_uren: { deze: number; volgende: number }
  toeslag_bedrag: number
}

export interface CheckLevertijdResponse {
  scenario: LevertijdScenario
  lever_datum: string | null
  vroegst_mogelijk?: string
  week: number
  jaar: number
  onderbouwing: string
  details: LevertijdDetails
  spoed?: SpoedDetails
}

export async function checkLevertijd(req: CheckLevertijdRequest): Promise<CheckLevertijdResponse> {
  const { data, error } = await supabase.functions.invoke('check-levertijd', { body: req })

  if (error) {
    let msg = error.message
    try {
      const ctx = (error as Record<string, unknown>).context as Response | undefined
      if (ctx?.json) {
        const parsed = await ctx.json()
        if (parsed?.error) msg = parsed.error
      }
    } catch { /* fallback */ }
    throw new Error(msg)
  }

  return data as CheckLevertijdResponse
}
