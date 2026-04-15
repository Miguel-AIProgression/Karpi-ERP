// Bereken bruikbare reststukken uit een FFDH snijplan-layout.
// Input: rol-dimensies + plaatsingen. Output: lijst rechthoekige vrije gebieden
// die groot genoeg zijn om als herbruikbaar reststuk te markeren.

import type { Placement } from './ffdh-packing.ts'

export interface ReststukRect {
  x_cm: number        // positie langs rol-breedte (X)
  y_cm: number        // positie langs rol-lengte (Y)
  breedte_cm: number  // afmeting langs X
  lengte_cm: number   // afmeting langs Y
}

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
  pieces: Placement[]  // gesorteerd op positie_x_cm
}

function groupShelves(plaatsingen: Placement[]): ShelfInfo[] {
  const byY = new Map<number, Placement[]>()
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
  plaatsingen: Placement[],
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

    // 1. Rechter-strip van shelf (naast laatste stuk, over volle shelf-hoogte)
    if (usedWidth < rolBreedte) {
      result.push({
        x_cm: usedWidth,
        y_cm: shelf.y,
        breedte_cm: rolBreedte - usedWidth,
        lengte_cm: shelf.height,
      })
    }

    // 2. Sliver onder elk stuk dat korter is dan shelf-hoogte
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

  // 3. End-of-roll strip na laatste shelf
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
