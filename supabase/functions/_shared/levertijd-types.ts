// Shared types voor real-time levertijd-check.
// Gebruikt door: check-levertijd edge function + frontend hook/component.

// ---------------------------------------------------------------------------
// Public API contract (request/response)
// ---------------------------------------------------------------------------

export interface CheckLevertijdRequest {
  kwaliteit_code: string
  kleur_code: string
  lengte_cm: number
  breedte_cm: number
  vorm?: 'rechthoek' | 'rond' | string
  gewenste_leverdatum?: string | null  // ISO YYYY-MM-DD
  debiteur_nr?: number | null
}

export type LevertijdScenario =
  | 'match_bestaande_rol'
  | 'nieuwe_rol_gepland'
  | 'wacht_op_orders'
  | 'spoed'

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

export interface CheckLevertijdResponse {
  scenario: LevertijdScenario
  lever_datum: string | null            // null bij wacht_op_orders → vroegst_mogelijk
  vroegst_mogelijk?: string             // alleen wanneer lever_datum onbekend
  week: number
  jaar: number
  onderbouwing: string                  // NL, max 240 chars
  details: LevertijdDetails
  spoed?: SpoedDetails
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

// ---------------------------------------------------------------------------
// Internal types — gebruikt door de helper-modules onderling
// ---------------------------------------------------------------------------

export interface LevertijdConfig {
  logistieke_buffer_dagen: number       // bv. 2
  backlog_minimum_m2: number            // bv. 12
  capaciteit_per_week: number           // bv. 450 (stuks)
  capaciteit_marge_pct: number          // bv. 0
  wisseltijd_minuten: number            // bv. 15 (per rol-wissel)
  snijtijd_minuten: number              // bv. 5 (per stuk)
  maatwerk_weken: number                // bv. 4 (pessimistische fallback)
  spoed_buffer_uren: number             // bv. 4 (min vrije uren per week voor spoed)
  spoed_toeslag_bedrag: number          // bv. 50 (€ vast bedrag)
  spoed_product_id: string              // bv. 'SPOEDTOESLAG'
}

// Snijplan-record gebruikt door reconstructShelves (één plaatsing op een rol).
export interface PlanRecord {
  id: number
  rol_id: number
  positie_x_cm: number
  positie_y_cm: number
  lengte_cm: number
  breedte_cm: number
  geroteerd: boolean
  planning_week: number | null
  planning_jaar: number | null
  afleverdatum: string | null
  status: string
}

// Kandidaat-rol uit de rollen-tabel gefilterd op uitwisselbaarheid + minimale afmetingen.
export interface KandidaatRol {
  id: number
  rolnummer: string
  lengte_cm: number
  breedte_cm: number
  status: string
  kwaliteit_code: string
  kleur_code: string
}

// Resultaat van rolHeeftPlek-check per kandidaat.
export interface RolMatchKandidaat {
  rol: KandidaatRol
  snij_datum: string
  is_exact: boolean
  waste_score: number   // tiebreaker: lager = beter
}

export type MatchResult =
  | {
      gevonden: true
      rol_id: number
      rolnummer: string
      snij_datum: string
      lever_datum: string
      kwaliteit_match: 'exact' | 'uitwisselbaar'
    }
  | {
      gevonden: false
      reden: 'geen_rol_in_pipeline' | 'geen_plek_op_bestaande_rollen'
    }

// Snijplannen-rij voor capaciteits-bezetting (week-aggregatie).
export interface BezettingsRow {
  id: number
  rol_id: number | null
}

export interface BezettingResultaat {
  stuks: number
  unieke_rollen: number
  minuten: number
}

export interface CapaciteitsCheckResult {
  week: number
  jaar: number
  huidig_stuks: number
  max_stuks: number
  ruimte_stuks: number
  iteraties: number   // hoe vaak doorgeschoven naar volgende week
}

export interface BacklogResult {
  totaal_m2: number
  aantal_stukken: number
  voldoende: boolean
}
