// Stap 2 van real-time levertijd-check: bepaal snij-week + capaciteits-check
// + backlog-drempel voor "nieuwe rol moet aangesneden worden"-scenario.

import type {
  BacklogResult,
  BezettingResultaat,
  BezettingsRow,
  CapaciteitsCheckResult,
  LevertijdConfig,
} from './levertijd-types.ts'
import { maandagVanWeek } from './levertijd-match.ts'

const MAX_WEEK_ITERATIES = 6

// ---------------------------------------------------------------------------
// ISO-week / datum helpers
// ---------------------------------------------------------------------------

/** Geef ISO-weeknummer + jaar voor een datum (UTC). */
export function isoWeekJaar(date: Date): { week: number; jaar: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  // ISO: donderdag bepaalt het jaar.
  const dayNr = (d.getUTCDay() + 6) % 7  // ma=0..zo=6
  d.setUTCDate(d.getUTCDate() - dayNr + 3)
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const firstThursdayDayNr = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNr + 3)
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
  return { week, jaar: d.getUTCFullYear() }
}

/** Snij-week is de week vóór de gewenste leverweek. */
export function snijWeekVoorLever(leverDatumIso: string): {
  week: number
  jaar: number
  maandag: string
} {
  const lever = new Date(`${leverDatumIso}T00:00:00Z`)
  lever.setUTCDate(lever.getUTCDate() - 7)
  const { week, jaar } = isoWeekJaar(lever)
  return { week, jaar, maandag: maandagVanWeek(week, jaar) }
}

/** Tel één ISO-week op (rolt over jaar-grens correct). */
export function nextWeek(week: number, jaar: number): { week: number; jaar: number } {
  const maandag = new Date(`${maandagVanWeek(week, jaar)}T00:00:00Z`)
  maandag.setUTCDate(maandag.getUTCDate() + 7)
  return isoWeekJaar(maandag)
}

// ---------------------------------------------------------------------------
// Bezetting per week
// ---------------------------------------------------------------------------

/** Bereken bezetting (stuks + minuten) voor een set snijplannen-rijen van één week. */
export function bezetting(
  rows: BezettingsRow[],
  cfg: Pick<LevertijdConfig, 'wisseltijd_minuten' | 'snijtijd_minuten'>,
): BezettingResultaat {
  const stuks = rows.length
  const unieke_rollen = new Set(
    rows.filter((r) => r.rol_id !== null).map((r) => r.rol_id),
  ).size
  const minuten = unieke_rollen * cfg.wisseltijd_minuten + stuks * cfg.snijtijd_minuten
  return { stuks, unieke_rollen, minuten }
}

// ---------------------------------------------------------------------------
// Capaciteits-check met week-iteratie
// ---------------------------------------------------------------------------

export interface CapaciteitsCheckInput {
  start_week: number
  start_jaar: number
  cfg: LevertijdConfig
  /** Async fetcher: geef snijplan-rijen voor (week, jaar) terug. */
  fetchBezetting: (week: number, jaar: number) => Promise<BezettingsRow[]>
}

/** Itereer door weken tot er ruimte is (max MAX_WEEK_ITERATIES). */
export async function capaciteitsCheck(
  input: CapaciteitsCheckInput,
): Promise<CapaciteitsCheckResult> {
  const { cfg, fetchBezetting } = input
  let week = input.start_week
  let jaar = input.start_jaar
  const max_stuks = Math.max(
    0,
    Math.round(cfg.capaciteit_per_week * (1 - cfg.capaciteit_marge_pct / 100)),
  )

  for (let i = 0; i < MAX_WEEK_ITERATIES; i++) {
    const rows = await fetchBezetting(week, jaar)
    const huidig_stuks = bezetting(rows, cfg).stuks
    const ruimte_stuks = max_stuks - huidig_stuks

    if (ruimte_stuks > 0) {
      return { week, jaar, huidig_stuks, max_stuks, ruimte_stuks, iteraties: i }
    }

    const nxt = nextWeek(week, jaar)
    week = nxt.week
    jaar = nxt.jaar
  }

  // Geen ruimte gevonden binnen horizon — return laatste poging als feitelijk vol.
  const rows = await fetchBezetting(week, jaar)
  const huidig_stuks = bezetting(rows, cfg).stuks
  return {
    week,
    jaar,
    huidig_stuks,
    max_stuks,
    ruimte_stuks: max_stuks - huidig_stuks,
    iteraties: MAX_WEEK_ITERATIES,
  }
}

// ---------------------------------------------------------------------------
// Backlog-drempel
// ---------------------------------------------------------------------------

/**
 * Bepaal of er voldoende backlog is voor deze kwaliteit/kleur om een nieuwe
 * rol efficient te benutten — anders is "wacht op meer orders" beter.
 */
export function backlogIsVoldoende(
  raw: { totaal_m2: number; aantal_stukken: number },
  nieuwStukM2: number,
  drempel_m2: number,
): BacklogResult {
  const totaal_m2 = raw.totaal_m2 + nieuwStukM2
  return {
    totaal_m2: raw.totaal_m2,
    aantal_stukken: raw.aantal_stukken,
    voldoende: totaal_m2 >= drempel_m2,
  }
}
