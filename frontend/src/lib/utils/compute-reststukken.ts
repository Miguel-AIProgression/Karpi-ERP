// Bereken bruikbare reststukken uit een snijplan-layout.
// Frontend-kopie van supabase/functions/_shared/compute-reststukken.ts
// (Deno-specifieke imports kunnen niet in Vite-bundle; logica is identiek.)

import type { ReststukRect, SnijvoorstelPlaatsing, SnijStuk } from '@/lib/types/productie'

export const RESTSTUK_MIN_SHORT = 70
export const RESTSTUK_MIN_LONG = 140

function qualifies(r: ReststukRect, minShort: number, minLong: number): boolean {
  const short = Math.min(r.breedte_cm, r.lengte_cm)
  const long = Math.max(r.breedte_cm, r.lengte_cm)
  return short >= minShort && long >= minLong
}

interface ShelfInfo {
  y: number
  height: number
  pieces: SnijvoorstelPlaatsing[]
}

function groupShelves(plaatsingen: SnijvoorstelPlaatsing[]): ShelfInfo[] {
  const byY = new Map<number, SnijvoorstelPlaatsing[]>()
  for (const p of plaatsingen) {
    const arr = byY.get(p.positie_y_cm) ?? []
    arr.push(p)
    byY.set(p.positie_y_cm, arr)
  }
  const shelves: ShelfInfo[] = []
  for (const [y, pieces] of byY) {
    pieces.sort((a, b) => a.positie_x_cm - b.positie_x_cm)
    const height = Math.max(...pieces.map((p) => p.breedte_cm))
    shelves.push({ y, height, pieces })
  }
  shelves.sort((a, b) => a.y - b.y)
  return shelves
}

export function computeReststukken(
  rolLengte: number,
  rolBreedte: number,
  plaatsingen: SnijvoorstelPlaatsing[],
  minShort: number = RESTSTUK_MIN_SHORT,
  minLong: number = RESTSTUK_MIN_LONG,
): ReststukRect[] {
  const result: ReststukRect[] = []
  if (plaatsingen.length === 0) {
    const full: ReststukRect = {
      x_cm: 0,
      y_cm: 0,
      breedte_cm: rolBreedte,
      lengte_cm: rolLengte,
    }
    return qualifies(full, minShort, minLong) ? [full] : []
  }

  const shelves = groupShelves(plaatsingen)

  for (const shelf of shelves) {
    const last = shelf.pieces[shelf.pieces.length - 1]
    const usedWidth = last.positie_x_cm + last.lengte_cm

    if (usedWidth < rolBreedte) {
      result.push({
        x_cm: usedWidth,
        y_cm: shelf.y,
        breedte_cm: rolBreedte - usedWidth,
        lengte_cm: shelf.height,
      })
    }

    for (const p of shelf.pieces) {
      const sliver = shelf.height - p.breedte_cm
      if (sliver > 0) {
        result.push({
          x_cm: p.positie_x_cm,
          y_cm: p.positie_y_cm + p.breedte_cm,
          breedte_cm: p.lengte_cm,
          lengte_cm: sliver,
        })
      }
    }
  }

  const lastShelf = shelves[shelves.length - 1]
  const totaalShelvesEind = lastShelf.y + lastShelf.height
  if (totaalShelvesEind < rolLengte) {
    result.push({
      x_cm: 0,
      y_cm: totaalShelvesEind,
      breedte_cm: rolBreedte,
      lengte_cm: rolLengte - totaalShelvesEind,
    })
  }

  return result.filter((r) => qualifies(r, minShort, minLong))
}

/**
 * Variant die ALLE resterende rechthoeken teruggeeft, gesplitst in
 * kwalificerende reststukken (≥ minShort × minLong) en afval (de rest > 0).
 */
export function computeReststukkenEnAfval(
  rolLengte: number,
  rolBreedte: number,
  plaatsingen: SnijvoorstelPlaatsing[],
  minShort: number = RESTSTUK_MIN_SHORT,
  minLong: number = RESTSTUK_MIN_LONG,
): { reststukken: ReststukRect[]; afval: ReststukRect[] } {
  const all: ReststukRect[] = []
  if (plaatsingen.length === 0) {
    const full: ReststukRect = { x_cm: 0, y_cm: 0, breedte_cm: rolBreedte, lengte_cm: rolLengte }
    all.push(full)
  } else {
    const shelves = groupShelves(plaatsingen)
    for (const shelf of shelves) {
      const last = shelf.pieces[shelf.pieces.length - 1]
      const usedWidth = last.positie_x_cm + last.lengte_cm
      if (usedWidth < rolBreedte) {
        all.push({
          x_cm: usedWidth,
          y_cm: shelf.y,
          breedte_cm: rolBreedte - usedWidth,
          lengte_cm: shelf.height,
        })
      }
      for (const p of shelf.pieces) {
        const sliver = shelf.height - p.breedte_cm
        if (sliver > 0) {
          all.push({
            x_cm: p.positie_x_cm,
            y_cm: p.positie_y_cm + p.breedte_cm,
            breedte_cm: p.lengte_cm,
            lengte_cm: sliver,
          })
        }
      }
    }
    const lastShelf = shelves[shelves.length - 1]
    const totaalShelvesEind = lastShelf.y + lastShelf.height
    if (totaalShelvesEind < rolLengte) {
      all.push({
        x_cm: 0,
        y_cm: totaalShelvesEind,
        breedte_cm: rolBreedte,
        lengte_cm: rolLengte - totaalShelvesEind,
      })
    }
  }

  const reststukken: ReststukRect[] = []
  const afval: ReststukRect[] = []
  for (const r of all) {
    if (r.breedte_cm <= 0 || r.lengte_cm <= 0) continue
    if (qualifies(r, minShort, minLong)) reststukken.push(r)
    else afval.push(r)
  }
  return { reststukken, afval }
}

/** Convenience: bereken reststukken direct uit SnijStuk-array. */
export function computeReststukkenFromStukken(
  rolLengte: number,
  rolBreedte: number,
  stukken: SnijStuk[],
  minShort: number = RESTSTUK_MIN_SHORT,
  minLong: number = RESTSTUK_MIN_LONG,
): ReststukRect[] {
  const plaatsingen: SnijvoorstelPlaatsing[] = stukken.map((s) => ({
    snijplan_id: s.snijplan_id ?? 0,
    positie_x_cm: s.x_cm,
    positie_y_cm: s.y_cm,
    lengte_cm: s.lengte_cm,
    breedte_cm: s.breedte_cm,
    geroteerd: s.geroteerd ?? false,
  }))
  return computeReststukken(rolLengte, rolBreedte, plaatsingen, minShort, minLong)
}

/** Convenience: reststukken + afval direct uit SnijStuk-array. */
export function computeReststukkenEnAfvalFromStukken(
  rolLengte: number,
  rolBreedte: number,
  stukken: SnijStuk[],
  minShort: number = RESTSTUK_MIN_SHORT,
  minLong: number = RESTSTUK_MIN_LONG,
): { reststukken: ReststukRect[]; afval: ReststukRect[] } {
  const plaatsingen: SnijvoorstelPlaatsing[] = stukken.map((s) => ({
    snijplan_id: s.snijplan_id ?? 0,
    positie_x_cm: s.x_cm,
    positie_y_cm: s.y_cm,
    lengte_cm: s.lengte_cm,
    breedte_cm: s.breedte_cm,
    geroteerd: s.geroteerd ?? false,
  }))
  return computeReststukkenEnAfval(rolLengte, rolBreedte, plaatsingen, minShort, minLong)
}

/**
 * Splitst de analyse verder: end-of-roll strip met volle breedte wordt als
 * "aangebrokenEnd" apart teruggegeven (de originele rol krijgt dan een
 * verkorte lengte — zie `voltooi_snijplan_rol(p_aangebroken_lengte)`).
 * Overige rechthoeken blijven reststukken (eigen rolnummer) of afval.
 *
 * `aangebrokenEnd` is alleen gezet wanneer rol_type in ('volle_rol',
 * 'aangebroken'); bij een reststuk-rol geeft deze functie altijd null
 * terug en blijft het oude reststuk-gedrag gelden.
 */
export function computeReststukkenAngebrokenAfval(
  rolLengte: number,
  rolBreedte: number,
  stukken: SnijStuk[],
  rolType: 'volle_rol' | 'aangebroken' | 'reststuk' | null | undefined,
  minShort: number = RESTSTUK_MIN_SHORT,
  minLong: number = RESTSTUK_MIN_LONG,
): {
  reststukken: ReststukRect[]
  aangebrokenEnd: { y_cm: number; breedte_cm: number; lengte_cm: number } | null
  afval: ReststukRect[]
} {
  const { reststukken: allRest, afval } = computeReststukkenEnAfvalFromStukken(
    rolLengte,
    rolBreedte,
    stukken,
    minShort,
    minLong,
  )

  const kanAanbreken = rolType === 'volle_rol' || rolType === 'aangebroken'
  if (!kanAanbreken) {
    return { reststukken: allRest, aangebrokenEnd: null, afval }
  }

  let aangebrokenEnd: { y_cm: number; breedte_cm: number; lengte_cm: number } | null = null
  const reststukken: ReststukRect[] = []
  for (const r of allRest) {
    const isFullWidthEnd = r.x_cm === 0 && r.breedte_cm === rolBreedte
    if (isFullWidthEnd && !aangebrokenEnd) {
      aangebrokenEnd = { y_cm: r.y_cm, breedte_cm: r.breedte_cm, lengte_cm: r.lengte_cm }
    } else {
      reststukken.push(r)
    }
  }
  return { reststukken, aangebrokenEnd, afval }
}
