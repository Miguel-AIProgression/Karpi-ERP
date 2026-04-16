// Stap 1 van real-time levertijd-check: zoek bestaande rol-planning waar het
// nieuwe stuk nog op past. Hergebruikt FFDH `tryPlacePiece` voor scoring.

import { tryPlacePiece, type Shelf, type SnijplanPiece } from './ffdh-packing.ts'
import type {
  KandidaatRol,
  MatchResult,
  PlanRecord,
  RolMatchKandidaat,
} from './levertijd-types.ts'

// ---------------------------------------------------------------------------
// Shelf-reconstructie uit bestaande snijplan-plaatsingen
// ---------------------------------------------------------------------------

/**
 * Reconstrueer FFDH `Shelf`-objecten uit reeds geplande stukken op een rol.
 * Groepeert plaatsingen op `positie_y_cm` (= top van de shelf).
 *
 * `rollWidth` is de breedte van de rol langs de X-as (= rol.breedte_cm).
 */
export function reconstructShelves(
  plaatsingen: PlanRecord[],
  rollWidth: number,
): Shelf[] {
  if (plaatsingen.length === 0) return []

  const byY = new Map<number, PlanRecord[]>()
  for (const p of plaatsingen) {
    const list = byY.get(p.positie_y_cm) ?? []
    list.push(p)
    byY.set(p.positie_y_cm, list)
  }

  return Array.from(byY.entries())
    .map(([y, items]) => ({
      y,
      height: Math.max(...items.map((p) => p.breedte_cm)),
      usedWidth: items.reduce((sum, p) => sum + p.lengte_cm, 0),
      maxWidth: rollWidth,
    }))
    .sort((a, b) => a.y - b.y)
}

// ---------------------------------------------------------------------------
// Plek-check voor één kandidaat-rol
// ---------------------------------------------------------------------------

/**
 * Check of een nieuw stuk past op een rol gegeven de bestaande plaatsingen.
 * Returnt `null` als het niet past, anders een waste-score (lager = beter).
 */
export function rolHeeftPlek(
  rol: KandidaatRol,
  bestaandePlaatsingen: PlanRecord[],
  nieuwStuk: SnijplanPiece,
): { waste_score: number } | null {
  const shelves = reconstructShelves(bestaandePlaatsingen, rol.breedte_cm)
  const placement = tryPlacePiece(
    nieuwStuk,
    shelves,
    rol.breedte_cm,
    rol.lengte_cm,
    [],
  )
  if (!placement) return null

  // Lagere score = minder verspilling. Combineer breedte- en hoogte-restant.
  const widthWaste = rol.breedte_cm - placement.lengte_cm
  const heightWaste = Math.max(0, rol.lengte_cm - (placement.positie_y_cm + placement.breedte_cm))
  const waste_score = widthWaste + heightWaste / 10
  return { waste_score }
}

// ---------------------------------------------------------------------------
// Snij-datum bepalen per rol uit gekoppelde plaatsingen
// ---------------------------------------------------------------------------

/** Maandag van een ISO-week (1-7 = ma-zo, returnt YYYY-MM-DD). */
export function maandagVanWeek(week: number, jaar: number): string {
  // ISO-week 1 bevat de eerste donderdag van het jaar.
  const simpel = new Date(Date.UTC(jaar, 0, 4))
  const dagvanWeek = simpel.getUTCDay() || 7
  const eersteMaandag = new Date(simpel)
  eersteMaandag.setUTCDate(simpel.getUTCDate() - dagvanWeek + 1)
  const result = new Date(eersteMaandag)
  result.setUTCDate(eersteMaandag.getUTCDate() + (week - 1) * 7)
  return result.toISOString().slice(0, 10)
}

/** Volgende werkdag (ma-vr) vanaf een datum (default: vandaag). ISO YYYY-MM-DD. */
export function volgendeWerkdag(vanaf: Date = new Date()): string {
  const d = new Date(Date.UTC(vanaf.getUTCFullYear(), vanaf.getUTCMonth(), vanaf.getUTCDate()))
  d.setUTCDate(d.getUTCDate() + 1)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return d.toISOString().slice(0, 10)
}

/**
 * Bepaal vroegste snij-datum voor een rol op basis van zijn plaatsingen.
 *
 * Prioriteit:
 *   1. `afleverdatum` op een plaatsing (uit orders.afleverdatum) → snij_datum = afleverdatum − logistieke_buffer
 *      (de rol moet vóór die leverdatum klaar zijn)
 *   2. `planning_week`/`planning_jaar` → maandag van die week
 *   3. Fallback: volgende werkdag
 */
export function snijDatumVoorRol(
  bestaande: PlanRecord[],
  logistiekeBufferDagen: number = 2,
  vandaag: Date = new Date(),
): string {
  const afleverdatums = bestaande
    .filter((p) => p.afleverdatum != null)
    .map((p) => p.afleverdatum as string)
  if (afleverdatums.length > 0) {
    afleverdatums.sort()
    return plusKalenderDagen(afleverdatums[0], -logistiekeBufferDagen)
  }

  const weekDatums = bestaande
    .filter((p) => p.planning_week != null && p.planning_jaar != null)
    .map((p) => maandagVanWeek(p.planning_week as number, p.planning_jaar as number))
  if (weekDatums.length > 0) {
    weekDatums.sort()
    return weekDatums[0]
  }
  return volgendeWerkdag(vandaag)
}

// ---------------------------------------------------------------------------
// Kies beste match uit alle kandidaten
// ---------------------------------------------------------------------------

/** Plus N kalenderdagen op een ISO-datum. */
export function plusKalenderDagen(isoDate: string, dagen: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dagen)
  return d.toISOString().slice(0, 10)
}

/**
 * Schuif een datum naar de eerstvolgende werkdag (ma-vr).
 * Als de input al een werkdag is, blijft die ongewijzigd.
 * Levering kan alleen op werkdagen plaatsvinden — gebruik dit na het optellen
 * van logistieke buffer-dagen voor lever_datum.
 */
export function naarWerkdag(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return d.toISOString().slice(0, 10)
}

/** Snelle helper: snij + buffer kalenderdagen, daarna naar werkdag. */
export function leverdatumVoorSnijDatum(snijDatum: string, bufferDagen: number): string {
  return naarWerkdag(plusKalenderDagen(snijDatum, bufferDagen))
}

export interface KiesBesteMatchInput {
  kandidaten: RolMatchKandidaat[]
  logistieke_buffer_dagen: number
}

export function kiesBesteMatch(input: KiesBesteMatchInput): MatchResult {
  const { kandidaten, logistieke_buffer_dagen } = input
  if (kandidaten.length === 0) {
    return { gevonden: false, reden: 'geen_plek_op_bestaande_rollen' }
  }

  const sorted = [...kandidaten].sort((a, b) => {
    if (a.snij_datum !== b.snij_datum) return a.snij_datum < b.snij_datum ? -1 : 1
    if (a.is_exact !== b.is_exact) return a.is_exact ? -1 : 1
    return a.waste_score - b.waste_score
  })

  const best = sorted[0]
  return {
    gevonden: true,
    rol_id: best.rol.id,
    rolnummer: best.rol.rolnummer,
    snij_datum: best.snij_datum,
    lever_datum: leverdatumVoorSnijDatum(best.snij_datum, logistieke_buffer_dagen),
    kwaliteit_match: best.is_exact ? 'exact' : 'uitwisselbaar',
  }
}
