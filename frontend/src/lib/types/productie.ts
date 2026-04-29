// Types for the maatwerk tapijt productiemodule

// === Enums as string literals ===

export type SnijplanStatus =
  | 'Gepland'
  | 'Snijden'
  | 'Gesneden'
  | 'In confectie'
  | 'Gereed'
  | 'Ingepakt'
  | 'Geannuleerd'

export type ConfectieStatus =
  | 'Wacht op materiaal'
  | 'In productie'
  | 'Kwaliteitscontrole'
  | 'Gereed'
  | 'Geannuleerd'

export type MaatwerkVorm = string  // Configureerbaar via maatwerk_vormen tabel
export type MaatwerkAfwerking = 'B' | 'FE' | 'LO' | 'ON' | 'SB' | 'SF' | 'VO' | 'ZO'
export type RolStatus = 'beschikbaar' | 'gereserveerd' | 'verkocht' | 'gesneden' | 'reststuk' | 'in_snijplan'
export type RolType = 'volle_rol' | 'aangebroken' | 'reststuk'
export type ScanActie = 'start' | 'gereed' | 'pauze' | 'herstart' | 'fout'

// === Snijplanning types ===

export interface SnijplanRow {
  id: number
  snijplan_nr: string
  scancode: string
  status: SnijplanStatus
  snij_lengte_cm: number
  snij_breedte_cm: number
  prioriteit: number
  planning_week: number | null
  planning_jaar: number | null
  afleverdatum: string | null
  positie_x_cm: number | null
  positie_y_cm: number | null
  geroteerd: boolean | null
  gesneden_datum: string | null
  gesneden_op: string | null
  gesneden_door: string | null
  // Rol info
  rol_id: number | null
  rolnummer: string | null
  kwaliteit_code: string | null
  kleur_code: string | null
  rol_lengte_cm: number | null
  rol_breedte_cm: number | null
  rol_oppervlak_m2: number | null
  rol_status: string | null
  locatie: string | null
  // Maatwerk specs (from order_regels)
  maatwerk_vorm: MaatwerkVorm | null
  maatwerk_lengte_cm: number | null
  maatwerk_breedte_cm: number | null
  maatwerk_afwerking: MaatwerkAfwerking | null
  maatwerk_band_kleur: string | null
  maatwerk_instructies: string | null
  /** Snij-marge per dimensie (rond/ovaal +5, ZO +6, max). Vanuit view (migratie 143). */
  marge_cm: number
  // Order info
  order_regel_id: number
  artikelnr: string | null
  product_omschrijving: string | null
  orderaantal: number | null
  order_id: number
  order_nr: string
  debiteur_nr: number
  klant_naam: string
}

/** Grouped by kwaliteit+kleur for the accordion view */
export interface SnijGroep {
  kwaliteit_code: string
  kleur_code: string
  product_naam: string  // e.g. "CISCO 11"
  rollen: SnijRolVoorstel[]
  totaal_stukken: number
  totaal_m2: number
  totaal_gesneden: number
}

/** Per-roll cutting proposal */
export interface SnijRolVoorstel {
  rol_id: number
  rolnummer: string
  rol_lengte_cm: number
  rol_breedte_cm: number
  rol_status: RolStatus
  locatie: string | null
  stukken: SnijStuk[]
  gebruikte_lengte_cm: number
  rest_lengte_cm: number
  afval_pct: number
  reststuk_bruikbaar: boolean
  reststukken?: ReststukRect[]
}

/** Individual piece on a roll */
export interface SnijStuk {
  snijplan_id: number | null
  order_regel_id: number
  order_nr: string
  klant_naam: string
  breedte_cm: number
  lengte_cm: number
  vorm: MaatwerkVorm
  afwerking: MaatwerkAfwerking | null
  x_cm: number  // position on roll
  y_cm: number  // position on roll
  geroteerd?: boolean
  afleverdatum: string | null
}

// === Confectie types ===

export interface ConfectieRow {
  id: number
  confectie_nr: string
  scancode: string
  type_bewerking: string
  instructies: string | null
  status: ConfectieStatus
  gereed_datum: string | null
  gestart_op: string | null
  gereed_op: string | null
  medewerker: string | null
  // From snijplan
  snijplan_nr: string
  snijplan_scancode: string
  gesneden_datum: string | null
  // Maatwerk specs
  maatwerk_afwerking: MaatwerkAfwerking | null
  maatwerk_band_kleur: string | null
  maatwerk_lengte_cm: number | null
  maatwerk_breedte_cm: number | null
  maatwerk_vorm: MaatwerkVorm | null
  artikelnr: string | null
  product_omschrijving: string | null
  // Rol info
  kwaliteit_code: string
  kleur_code: string
  rolnummer: string | null
  // Order info
  order_nr: string
  debiteur_nr: number
  klant_naam: string
}

// === Scan types ===

export interface ScanEvent {
  id: number
  scancode: string
  actie: ScanActie
  station: string | null
  medewerker: string | null
  notitie: string | null
  gescand_op: string
}

export interface ScannedItem {
  type: 'snijplan' | 'confectie'
  id: number
  scancode: string
  status: string
  kwaliteit_code: string
  kleur_code: string
  maat: string  // formatted "200x290"
  klant_naam: string
  order_nr: string
  afwerking: string | null
}

// === Rollen types ===

export interface RolRow {
  id: number
  rolnummer: string
  artikelnr: string
  kwaliteit_code: string
  kleur_code: string
  lengte_cm: number
  breedte_cm: number
  oppervlak_m2: number
  status: RolStatus
  rol_type: RolType
  locatie: string | null
  oorsprong_rol_id: number | null
  reststuk_datum: string | null
}

export interface UitwisselbarePartner {
  kwaliteit_code: string
  kleur_code: string
  rollen: number
  m2: number
}

export interface BesteldInkoopInfo {
  besteld_m: number
  besteld_m2: number
  orders_count: number
  eerstvolgende_leverweek: string | null
  eerstvolgende_verwacht_datum: string | null
  eerstvolgende_m: number
  eerstvolgende_m2: number
}

export interface RolGroep {
  kwaliteit_code: string
  kleur_code: string
  product_naam: string
  rollen: RolRow[]
  totaal_rollen: number
  totaal_m2: number
  volle_rollen: number
  aangebroken: number
  reststukken: number
  /** Beste uitwisselbare kwaliteit+kleur met beschikbare voorraad, NULL als er geen is. */
  equiv_kwaliteit_code: string | null
  equiv_kleur_code: string | null
  equiv_rollen: number
  equiv_m2: number
  /** Alle uitwisselbare partners uit dezelfde uitwisselgroep, gesorteerd op m² DESC. */
  uitwisselbare_partners: UitwisselbarePartner[]
  /** Openstaande inkooporders voor deze kwaliteit+kleur, NULL als er geen zijn. */
  inkoop: BesteldInkoopInfo | null
}

// === Magazijn types ===

export interface MagazijnItem {
  type: 'op_maat' | 'standaard'
  snijplan_id: number | null
  scancode: string | null
  order_nr: string
  klant_naam: string
  product: string
  kleur: string
  maat_cm: string
  m2: number
  kostprijs: number | null
  status: string
  locatie: string | null
}

// === Planning config ===

export interface PlanningConfig {
  planning_modus: 'weken' | 'capaciteit'
  capaciteit_per_week: number
  capaciteit_marge_pct: number
  weken_vooruit: number
  max_reststuk_verspilling_pct: number
  wisseltijd_minuten: number
  snijtijd_minuten: number
  confectie_buffer_minuten: number
}

// === Snijvoorstel types ===

export interface SnijvoorstelSamenvatting {
  totaal_stukken: number
  geplaatst: number
  niet_geplaatst: number
  totaal_rollen: number
  gemiddeld_afval_pct: number
  totaal_m2_gebruikt: number
  totaal_m2_afval: number
}

export interface SnijvoorstelPlaatsing {
  snijplan_id: number
  positie_x_cm: number
  positie_y_cm: number
  lengte_cm: number
  breedte_cm: number
  geroteerd: boolean
}

export interface ReststukRect {
  x_cm: number
  y_cm: number
  breedte_cm: number
  lengte_cm: number
}

export interface SnijvoorstelRol {
  rol_id: number
  rolnummer: string
  rol_lengte_cm: number
  rol_breedte_cm: number
  rol_status: RolStatus
  plaatsingen: SnijvoorstelPlaatsing[]
  gebruikte_lengte_cm: number
  afval_percentage: number
  restlengte_cm: number
  reststukken: ReststukRect[]
}

export interface SnijvoorstelNietGeplaatst {
  snijplan_id: number
  reden: string
}

export interface SnijvoorstelResponse {
  voorstel_id: number
  voorstel_nr: string
  rollen: SnijvoorstelRol[]
  niet_geplaatst: SnijvoorstelNietGeplaatst[]
  samenvatting: SnijvoorstelSamenvatting
}

export type SnijvoorstelStatus = 'concept' | 'goedgekeurd' | 'verworpen'

export interface SnijvoorstelRow {
  id: number
  voorstel_nr: string
  kwaliteit_code: string
  kleur_code: string
  status: SnijvoorstelStatus
  totaal_stukken: number
  totaal_rollen: number
  totaal_m2_gebruikt: number
  totaal_m2_afval: number
  afval_percentage: number
  aangemaakt_door: string | null
  created_at: string
}

export interface SnijvoorstelPlaatsingRow {
  id: number
  voorstel_id: number
  snijplan_id: number
  rol_id: number
  positie_x_cm: number
  positie_y_cm: number
  geroteerd: boolean
  lengte_cm: number
  breedte_cm: number
}

// === Dashboard stats ===

export interface ProductieDashboard {
  snijplannen_wacht: number
  snijplannen_gepland: number
  snijplannen_in_productie: number
  snijplannen_gesneden: number
  confectie_wacht: number
  confectie_actief: number
  confectie_gereed: number
  beschikbare_rollen: number
  reststukken: number
}
