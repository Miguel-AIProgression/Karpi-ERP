import type { ConfectiePlanningForwardRow } from '@/lib/supabase/queries/confectie-planning'

const GEEN_LANE = '__geen_lane__' as const

/** ISO-weeksleutel "YYYY-Www" uit een YYYY-MM-DD datum (canoniek algoritme). */
export function isoWeekKey(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  // Zet d naar de donderdag van diezelfde ISO-week (bepaalt het ISO-jaar)
  const dow = d.getDay() || 7 // zo=7, ma=1, ... za=6
  d.setDate(d.getDate() + 4 - dow)
  const jaar = d.getFullYear()
  const yearStart = new Date(jaar, 0, 1)
  const diffDagen = Math.round((d.getTime() - yearStart.getTime()) / 86400000)
  const week = Math.ceil((diffDagen + 1) / 7)
  return `${jaar}-W${String(week).padStart(2, '0')}`
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
