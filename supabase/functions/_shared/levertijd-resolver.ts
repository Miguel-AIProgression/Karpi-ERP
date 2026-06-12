// Combineert match (stap 1) + capacity (stap 2) tot één scenario + onderbouwing.

import type {
  BacklogResult,
  CapaciteitsCheckResult,
  CheckLevertijdResponse,
  LevertijdConfig,
  LevertijdScenario,
  MatchResult,
} from './levertijd-types.ts'
import {
  isoWeekJaar,
  snijWeekVoorLever,
} from './levertijd-capacity.ts'
import {
  maandagVanWeek,
  plusKalenderDagen,
  naarWerkdag,
  leverdatumVoorSnijDatum,
} from './levertijd-match.ts'

// ---------------------------------------------------------------------------
// NL formatting
// ---------------------------------------------------------------------------

const MAX_ONDERBOUWING_LEN = 240

function formatDatum(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

function trim(text: string): string {
  return text.length > MAX_ONDERBOUWING_LEN ? text.slice(0, MAX_ONDERBOUWING_LEN - 1) + '…' : text
}

// ---------------------------------------------------------------------------
// Spoed-detectie
// ---------------------------------------------------------------------------

const SPOED_DREMPEL_DAGEN = 2

export function isSpoed(gewensteLeverdatum: string | null | undefined, vandaag: Date = new Date()): boolean {
  if (!gewensteLeverdatum) return false
  const lever = new Date(`${gewensteLeverdatum}T00:00:00Z`)
  const nu = new Date(Date.UTC(vandaag.getUTCFullYear(), vandaag.getUTCMonth(), vandaag.getUTCDate()))
  const diff = (lever.getTime() - nu.getTime()) / 86_400_000
  return diff < SPOED_DREMPEL_DAGEN
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export interface ResolveScenarioInput {
  match: MatchResult
  capaciteit: CapaciteitsCheckResult
  backlog: BacklogResult
  cfg: LevertijdConfig
  gewenste_leverdatum?: string | null
  nieuw_stuk_m2: number
  vandaag?: Date
  /** Indien true: er is geen rol breed/lang genoeg in voorraad om dit stuk te snijden. */
  geen_rol_passend?: boolean
  /**
   * Capaciteits-resultaat startend vanaf de huidige week. Wanneer dit een
   * snij-week oplevert die eerder valt dan `capaciteit` (gewenste-aligned),
   * wordt de afgeleide vroegst haalbare leverdatum als hint meegegeven.
   */
  capaciteit_nu?: CapaciteitsCheckResult
}

export function resolveScenario(input: ResolveScenarioInput): CheckLevertijdResponse {
  const {
    match,
    capaciteit,
    backlog,
    cfg,
    gewenste_leverdatum,
    nieuw_stuk_m2,
    vandaag = new Date(),
    geen_rol_passend = false,
    capaciteit_nu,
  } = input

  const spoed = isSpoed(gewenste_leverdatum, vandaag)

  // Scenario 1: Match op bestaande rol
  if (match.gevonden) {
    const scenario: LevertijdScenario = spoed && match.lever_datum > (gewenste_leverdatum ?? '')
      ? 'spoed'
      : 'match_bestaande_rol'
    const { week, jaar } = isoWeekJaar(new Date(`${match.lever_datum}T00:00:00Z`))
    return {
      scenario,
      lever_datum: match.lever_datum,
      week,
      jaar,
      onderbouwing: trim(
        `Past op rol ${match.rolnummer} (snij-week ${isoWeekJaar(new Date(`${match.snij_datum}T00:00:00Z`)).week}, ${formatDatum(match.snij_datum)})${match.kwaliteit_match === 'uitwisselbaar' ? ' — uitwisselbare kwaliteit' : ''}`,
      ),
      details: {
        match_rol: {
          rol_id: match.rol_id,
          rolnummer: match.rolnummer,
          snij_datum: match.snij_datum,
          kwaliteit_match: match.kwaliteit_match,
        },
        spoed,
        logistieke_buffer_dagen: cfg.logistieke_buffer_dagen,
      },
    }
  }

  // Scenario 4: Geen rol breed/lang genoeg in voorraad → wacht op orders
  if (geen_rol_passend) {
    const vroegst = naarWerkdag(plusKalenderDagen(toIsoDate(vandaag), cfg.maatwerk_weken * 7), cfg.werktijden)
    const { week, jaar } = isoWeekJaar(new Date(`${vroegst}T00:00:00Z`))
    return {
      scenario: 'wacht_op_orders',
      lever_datum: null,
      vroegst_mogelijk: vroegst,
      week,
      jaar,
      onderbouwing: trim(
        `Geen rol breed/lang genoeg in voorraad — inkoop nodig. Pessimistische schatting: ${formatDatum(vroegst)}.`,
      ),
      details: {
        backlog: { ...backlog, drempel_m2: cfg.backlog_minimum_m2 },
        spoed,
        logistieke_buffer_dagen: cfg.logistieke_buffer_dagen,
      },
    }
  }

  // Scenario 2: Nieuwe rol gepland in (mogelijk doorgeschoven) snij-week.
  //
  // De backlog-drempel (`backlog.voldoende`) wordt bewust NIET gebruikt om
  // wachten af te dwingen: doelstelling is altijd "zo snel mogelijk leveren
  // mits het andere orders niet hindert". De capaciteits-check verschuift al
  // naar een latere week als de huidige vol zit, dus orders blokkeren elkaar
  // niet. Lage backlog blijft zichtbaar in `details.backlog` voor planners,
  // maar leidt niet tot scenario `wacht_op_orders`.
  const leverDatumVoorSnijWeek = (cap: CapaciteitsCheckResult): string => {
    const snijMaandag = maandagVanWeek(cap.week, cap.jaar)
    // 5 werkdagen na snij-maandag → vrijdag dezelfde week + buffer
    const snijVrijdag = plusKalenderDagen(snijMaandag, 4)
    return leverdatumVoorSnijDatum(snijVrijdag, cfg.logistieke_buffer_dagen, cfg.werktijden)
  }

  const snijMaandag = maandagVanWeek(capaciteit.week, capaciteit.jaar)
  const leverDatum = leverDatumVoorSnijWeek(capaciteit)
  const { week, jaar } = isoWeekJaar(new Date(`${leverDatum}T00:00:00Z`))

  const scenario: LevertijdScenario = spoed && leverDatum > (gewenste_leverdatum ?? '') ? 'spoed' : 'nieuwe_rol_gepland'

  // "Eerder haalbaar"-hint: alleen tonen wanneer de huidige-week-check een
  // strikt eerdere snij-week vindt dan de gewenste-aligned check. Anders is
  // de hint identiek aan het hoofd-voorstel en alleen ruis voor de operator.
  let eerderHaalbaar: { lever_datum: string; snij_week: number; snij_jaar: number } | undefined
  if (capaciteit_nu && capaciteit_nu.ruimte_stuks > 0) {
    const nuLeverDatum = leverDatumVoorSnijWeek(capaciteit_nu)
    if (nuLeverDatum < leverDatum) {
      eerderHaalbaar = {
        lever_datum: nuLeverDatum,
        snij_week: capaciteit_nu.week,
        snij_jaar: capaciteit_nu.jaar,
      }
    }
  }

  return {
    scenario,
    lever_datum: leverDatum,
    week,
    jaar,
    onderbouwing: trim(
      `Nieuwe rol gepland in week ${capaciteit.week} (${formatDatum(snijMaandag)}); capaciteit ${capaciteit.huidig_stuks}/${capaciteit.max_stuks} stuks${capaciteit.iteraties > 0 ? ` — ${capaciteit.iteraties} week(en) doorgeschoven` : ''}.`,
    ),
    details: {
      capaciteit,
      backlog: { ...backlog, drempel_m2: cfg.backlog_minimum_m2 },
      spoed,
      logistieke_buffer_dagen: cfg.logistieke_buffer_dagen,
      ...(eerderHaalbaar ? { eerder_haalbaar: eerderHaalbaar } : {}),
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIsoDate(d: Date): string {
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  return utc.toISOString().slice(0, 10)
}

// Re-export voor edge function
export { snijWeekVoorLever }
