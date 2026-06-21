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
import { isoWeekJaar } from './iso-week.ts'
import { werkdagenInIsoWeek } from './werkagenda.ts'
import { bepaalSnijtijdMinuten } from './snijtijd.ts'

const MAX_WEEK_ITERATIES = 6

// ---------------------------------------------------------------------------
// ISO-week / datum helpers
// ---------------------------------------------------------------------------

// `isoWeekJaar` komt uit de gedeelde UTC-kern (`_shared/iso-week.ts`) en wordt
// hier doorgegeven zodat bestaande importers (check-levertijd, levertijd-
// resolver, tests) onveranderd blijven werken.
export { isoWeekJaar }

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

/** Bereken bezetting (stuks + minuten) voor een set snijplannen-rijen van één week.
 *  Snijtijd is per-vorm (mig 460) i.p.v. een vlak tarief. */
export function bezetting(
  rows: BezettingsRow[],
  cfg: Pick<LevertijdConfig, 'wisseltijd_minuten'>,
  vormTarieven: Map<string, number>,
  moeilijkeKwaliteiten: Set<string>,
): BezettingResultaat {
  const stuks = rows.length
  const unieke_rollen = new Set(
    rows.filter((r) => r.rol_id !== null).map((r) => r.rol_id),
  ).size
  const snijMinuten = rows.reduce(
    (s, r) => s + bepaalSnijtijdMinuten(r.maatwerk_vorm, r.kwaliteit_code, vormTarieven, moeilijkeKwaliteiten),
    0,
  )
  const minuten = unieke_rollen * cfg.wisseltijd_minuten + snijMinuten
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
  /** Snijtijd per vorm (mig 460) — zie _shared/snijtijd.ts. */
  vormTarieven: Map<string, number>
  moeilijkeKwaliteiten: Set<string>
}

/**
 * Rollen-streefwaarde-grens voor een ISO-week (Fase 3): max_rollen_per_dag_streef
 * × het aantal werkdagen in die week (feestdagen-bewust, zie werkdagenInIsoWeek).
 * Puur informatief — beïnvloedt de week-iteratie in capaciteitsCheck niet.
 */
function rollenStreefVoorWeek(
  week: number,
  jaar: number,
  cfg: Pick<LevertijdConfig, 'max_rollen_per_dag_streef' | 'werktijden'>,
): number {
  const maandag = maandagVanWeek(week, jaar)
  const werkdagen = werkdagenInIsoWeek(maandag, cfg.werktijden)
  return Math.round(cfg.max_rollen_per_dag_streef * werkdagen)
}

/** Itereer door weken tot er ruimte is (max MAX_WEEK_ITERATIES). */
export async function capaciteitsCheck(
  input: CapaciteitsCheckInput,
): Promise<CapaciteitsCheckResult> {
  const { cfg, fetchBezetting, vormTarieven, moeilijkeKwaliteiten } = input
  let week = input.start_week
  let jaar = input.start_jaar
  const marge = 1 - cfg.capaciteit_marge_pct / 100
  // max_stuks = de enige echte blokkerende grens (Fase 3: het 400-max, niet de
  // 350-streef) — de loop hieronder schuift dus pas naar een volgende week als
  // zelfs het geëscaleerde maximum niet genoeg ruimte biedt. max_stuks_streef
  // wordt apart gerapporteerd zodat de caller kan zien of escalatie nodig was.
  const max_stuks = Math.max(0, Math.round(cfg.capaciteit_per_week_max * marge))
  const max_stuks_streef = Math.max(0, Math.round(cfg.capaciteit_per_week_streef * marge))

  for (let i = 0; i < MAX_WEEK_ITERATIES; i++) {
    const rows = await fetchBezetting(week, jaar)
    const bez = bezetting(rows, cfg, vormTarieven, moeilijkeKwaliteiten)
    const ruimte_stuks = max_stuks - bez.stuks

    if (ruimte_stuks > 0) {
      const max_rollen_streef = rollenStreefVoorWeek(week, jaar, cfg)
      return {
        week,
        jaar,
        huidig_stuks: bez.stuks,
        max_stuks,
        max_stuks_streef,
        binnen_streef: bez.stuks <= max_stuks_streef,
        ruimte_stuks,
        iteraties: i,
        huidig_rollen: bez.unieke_rollen,
        max_rollen_streef,
        rollen_overschreden: bez.unieke_rollen > max_rollen_streef,
      }
    }

    const nxt = nextWeek(week, jaar)
    week = nxt.week
    jaar = nxt.jaar
  }

  // Geen ruimte gevonden binnen horizon — return laatste poging als feitelijk vol.
  const rows = await fetchBezetting(week, jaar)
  const bez = bezetting(rows, cfg, vormTarieven, moeilijkeKwaliteiten)
  const max_rollen_streef = rollenStreefVoorWeek(week, jaar, cfg)
  return {
    week,
    jaar,
    huidig_stuks: bez.stuks,
    max_stuks,
    max_stuks_streef,
    binnen_streef: bez.stuks <= max_stuks_streef,
    ruimte_stuks: max_stuks - bez.stuks,
    iteraties: MAX_WEEK_ITERATIES,
    huidig_rollen: bez.unieke_rollen,
    max_rollen_streef,
    rollen_overschreden: bez.unieke_rollen > max_rollen_streef,
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
