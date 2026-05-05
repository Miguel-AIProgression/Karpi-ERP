// Pure spoed-evaluatie: kan een nieuw stuk in deze of volgende ISO-week
// gesneden worden, gegeven de bestaande werkagenda en een buffer-eis?
//
// Een week telt als "vol" wanneer er minder dan `spoed_buffer_uren` vrije
// werkminuten over zijn na alle bestaande planning. Anders kan de spoed-stuk
// na de huidige backlog-cursor in die week ingepland worden.

import type { LevertijdConfig, SpoedDetails } from './levertijd-types.ts'
import {
  type RolAgendaSlot,
  type Werktijden,
  STANDAARD_WERKTIJDEN,
  volgendeWerkminuut,
  plusWerkminuten,
  werkminutenTussen,
} from './werkagenda.ts'
import { naarWerkdag } from './levertijd-match.ts'

const MIN_PER_WEEKDAG = 510  // 09:00-uur netto (08:00-17:00 minus 30 min pauze)

function isoWeekStart(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = out.getUTCDay() || 7
  out.setUTCDate(out.getUTCDate() - (dow - 1))
  return out
}

function plusWeken(d: Date, n: number): Date {
  const out = new Date(d.getTime())
  out.setUTCDate(out.getUTCDate() + n * 7)
  return out
}

function bezetWerkminutenInWeek(
  agenda: Map<number, RolAgendaSlot>,
  weekStart: Date,
  weekEinde: Date,
  werktijden: Werktijden,
): number {
  let totaal = 0
  for (const slot of agenda.values()) {
    if (slot.eind <= weekStart || slot.start >= weekEinde) continue
    const overlapStart = slot.start > weekStart ? slot.start : weekStart
    const overlapEind = slot.eind < weekEinde ? slot.eind : weekEinde
    totaal += werkminutenTussen(overlapStart, overlapEind, werktijden)
  }
  return totaal
}

function isoWeekEnJaar(d: Date): { week: number; jaar: number } {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return { week, jaar: tmp.getUTCFullYear() }
}

export function evalueerSpoed(
  werkagenda: Map<number, RolAgendaSlot>,
  nieuwStukDuurMinuten: number,
  cfg: LevertijdConfig,
  vandaag: Date,
  werktijden: Werktijden = STANDAARD_WERKTIJDEN,
): SpoedDetails {
  const buffer = cfg.spoed_buffer_uren * 60
  const dezeWeek = isoWeekStart(vandaag)
  const eindDezeWeek = plusWeken(dezeWeek, 1)
  const volgendeWeek = plusWeken(dezeWeek, 1)
  const eindVolgendeWeek = plusWeken(dezeWeek, 2)

  // Hard reject: als de bestaande backlog al rollen bevat die te laat zijn
  // (snij-eind valt na leverdatum − logistieke_buffer), zit de planner al in
  // nood. Spoed mag dan niet beloofd worden — daarmee zouden we andere stukken
  // alleen nog verder achteruit duwen.
  for (const slot of werkagenda.values()) {
    if (slot.teLaat) {
      return {
        beschikbaar: false,
        scenario: 'spoed_geen_plek',
        snij_datum: null,
        lever_datum: null,
        week: null,
        jaar: null,
        week_restruimte_uren: { deze: 0, volgende: 0 },
        toeslag_bedrag: cfg.spoed_toeslag_bedrag,
      }
    }
  }

  const bezetDeze = bezetWerkminutenInWeek(werkagenda, dezeWeek, eindDezeWeek, werktijden)
  const bezetVolgende = bezetWerkminutenInWeek(werkagenda, volgendeWeek, eindVolgendeWeek, werktijden)
  const totaalWeekMin = MIN_PER_WEEKDAG * werktijden.werkdagen.length
  const restDeze = totaalWeekMin - bezetDeze - buffer
  const restVolgende = totaalWeekMin - bezetVolgende - buffer

  const week_restruimte_uren = {
    deze: Math.round((Math.max(0, restDeze) / 60) * 10) / 10,
    volgende: Math.round((Math.max(0, restVolgende) / 60) * 10) / 10,
  }

  // Spoed = krijgt voorrang in de planning. We hoeven dus niet "na" de
  // backlog te plaatsen — alleen te checken of de week genoeg restcapaciteit
  // heeft. De snij-datum belofte is de laatste werkdag van de gekozen week
  // (of vandaag indien later — geen datum in het verleden).
  function laatsteWerkdagVanWeek(weekStart: Date): Date {
    const out = new Date(weekStart.getTime())
    // weekStart = maandag 00:00. werkdagen.length=5 → vrijdag = +4 dagen.
    const aantalWerkdagen = werktijden.werkdagen.length
    out.setUTCDate(out.getUTCDate() + (aantalWerkdagen - 1))
    return out
  }

  function spoedDatum(weekStart: Date): Date {
    const vrijdag = laatsteWerkdagVanWeek(weekStart)
    return vrijdag > vandaag ? vrijdag : volgendeWerkminuut(vandaag, werktijden)
  }

  let scenario: SpoedDetails['scenario'] = 'spoed_geen_plek'
  let snij_datum: string | null = null

  if (restDeze >= nieuwStukDuurMinuten) {
    scenario = 'spoed_deze_week'
    snij_datum = spoedDatum(dezeWeek).toISOString().slice(0, 10)
  } else if (restVolgende >= nieuwStukDuurMinuten) {
    scenario = 'spoed_volgende_week'
    snij_datum = spoedDatum(volgendeWeek).toISOString().slice(0, 10)
  }

  let lever_datum: string | null = null
  let week: number | null = null
  let jaar: number | null = null
  if (snij_datum) {
    const ruw = new Date(`${snij_datum}T00:00:00Z`)
    ruw.setUTCDate(ruw.getUTCDate() + cfg.logistieke_buffer_dagen)
    lever_datum = naarWerkdag(ruw.toISOString().slice(0, 10))
    const wj = isoWeekEnJaar(new Date(`${lever_datum}T00:00:00Z`))
    week = wj.week
    jaar = wj.jaar
  }

  return {
    beschikbaar: snij_datum !== null,
    scenario,
    snij_datum,
    lever_datum,
    week,
    jaar,
    week_restruimte_uren,
    toeslag_bedrag: cfg.spoed_toeslag_bedrag,
  }
}
