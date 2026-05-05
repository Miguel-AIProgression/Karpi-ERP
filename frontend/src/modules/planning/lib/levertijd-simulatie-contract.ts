// LevertijdSimulatieContract — gedeelde types voor de planning-seam.
//
// Deze types vormen het contract tussen de orders-module (consumer) en de
// planning-module (provider). De seam-functie `simuleerLevertijd` geeft
// altijd een `SeamResult` terug — nooit een thrown exception.

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** Eén maatwerk-orderregel zoals de orders-module die aanlevert. */
export interface MaatwerkRegelConcept {
  /** Tijdelijk ID voor correlatie; UUID of lokale sleutel. */
  regel_id: string
  kwaliteit_code: string
  kleur_code: string
  lengte_cm: number
  breedte_cm: number
  /** Optionele vorm (bijv. 'rechthoek', 'rond', 'ovaal'). */
  vorm?: string | null
  /** Gewenste leverdatum in ISO-8601 (YYYY-MM-DD). */
  gewenste_leverdatum?: string | null
  debiteur_nr?: number | null
}

// ---------------------------------------------------------------------------
// Output per regel
// ---------------------------------------------------------------------------

/** Scenario-enum voor de uitkomst per orderregel. */
export type PlanningScenario =
  | 'match_bestaande_rol'
  | 'nieuwe_rol_gepland'
  | 'wacht_op_orders'
  | 'spoed_mogelijk'

/** Gesimuleerd plannings-resultaat voor één maatwerk-regelconcept. */
export interface PerRegelScenario {
  /** Correleert met `MaatwerkRegelConcept.regel_id`. */
  regel_id: string
  scenario: PlanningScenario
  /** ISO-datum waarop snijden gepland is, of null als onbekend. */
  snij_datum: string | null
  /** ISO-datum waarop levering verwacht wordt, of null als onbekend. */
  lever_datum: string | null
  /** Spoed-toeslag in euro's, of null als spoed niet van toepassing is. */
  spoed_toeslag_bedrag: number | null
  /** Mensvriendelijke onderbouwing, max 240 tekens. */
  onderbouwing: string
}

// ---------------------------------------------------------------------------
// Seam-resultaat
// ---------------------------------------------------------------------------

export type SeamResult =
  | { ok: true; scenarios: PerRegelScenario[] }
  | { ok: false; error: 'planning_unavailable' | 'invalid_input'; message: string }
