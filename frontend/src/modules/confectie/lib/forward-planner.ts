import { isoWeekStringVanIso } from '@/lib/utils/iso-week'
import type { ConfectiePlanningForwardRow } from '../queries/confectie-planning'

const GEEN_LANE = '__geen_lane__' as const

/** ISO-weeksleutel "YYYY-Www" uit een YYYY-MM-DD datum (UTC-kern). */
export function isoWeekKey(iso: string): string {
  return isoWeekStringVanIso(iso) ?? ''
}

export function groepeerPerLaneEnWeek(
  rows: ConfectiePlanningForwardRow[],
): Map<string, Map<string, ConfectiePlanningForwardRow[]>> {
  const result = new Map<string, Map<string, ConfectiePlanningForwardRow[]>>()
  for (const r of rows) {
    const lane = r.type_bewerking ?? GEEN_LANE
    const week = isoWeekKey(r.confectie_startdatum)
    let perWeek = result.get(lane)
    if (!perWeek) {
      perWeek = new Map()
      result.set(lane, perWeek)
    }
    const lijst = perWeek.get(week) ?? []
    lijst.push(r)
    perWeek.set(week, lijst)
  }
  return result
}

export interface LaneWerktijd {
  minuten_per_meter: number
  wisseltijd_minuten: number
  parallelle_werkplekken: number
}

export interface Bezetting {
  nodigMin: number
  beschikbaarMin: number
  overload: boolean
}

export function bezettingPerWeek(
  rows: ConfectiePlanningForwardRow[],
  werktijd: LaneWerktijd,
  werkminutenPerWeek: number,
): Bezetting {
  let nodig = 0
  for (const r of rows) {
    const meters = (r.strekkende_meter_cm ?? 0) / 100
    nodig += meters * werktijd.minuten_per_meter + werktijd.wisseltijd_minuten
  }
  const beschikbaar = werkminutenPerWeek * werktijd.parallelle_werkplekken
  return {
    nodigMin: Math.round(nodig),
    beschikbaarMin: beschikbaar,
    overload: nodig > beschikbaar,
  }
}
