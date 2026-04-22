// Bereken bruikbare reststukken uit een snijplan-layout.
// Input: rol-dimensies + plaatsingen. Output: lijst rechthoekige vrije gebieden
// die groot genoeg zijn om als herbruikbaar reststuk te markeren.
//
// Strategie: free-rect subtraction (zelfde logic als guillotine-packing) +
// disjoint greedy cover. De oudere shelf-based benadering miste interne gaps
// zoals "rechter strip + sliver onder korter stuk → samengevoegde rechthoek
// onder de shelf". Door met subtract + greedy disjoint cover te werken vinden
// we exact dezelfde reststukken die het placement-algoritme "ziet", zodat de
// UI de werkelijke restwaarde toont.
//
// Waarom disjoint (i.p.v. maximal rectangles met overlap): twee overlappende
// reststukken zouden in de UI suggereren dat we dezelfde fysieke ruimte 2×
// op voorraad kunnen zetten — dat is ondoenlijk. Greedy (grootste kwalificerend
// eerst, dan obstacle voor de volgende iteratie) levert een praktische cover.

import type { Placement } from './ffdh-packing.ts'

export interface ReststukRect {
  x_cm: number        // positie langs rol-breedte (X)
  y_cm: number        // positie langs rol-lengte (Y)
  breedte_cm: number  // afmeting langs X
  lengte_cm: number   // afmeting langs Y
}

export const RESTSTUK_MIN_SHORT = 50
export const RESTSTUK_MIN_LONG = 100

function qualifies(r: ReststukRect, minShort: number, minLong: number): boolean {
  const short = Math.min(r.breedte_cm, r.lengte_cm)
  const long = Math.max(r.breedte_cm, r.lengte_cm)
  return short >= minShort && long >= minLong
}

interface FreeRect {
  x: number
  y: number
  width: number
  height: number
}

function intersects(a: FreeRect, b: FreeRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

function contains(outer: FreeRect, inner: FreeRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

function subtractRect(freeList: FreeRect[], obstacle: FreeRect): FreeRect[] {
  const result: FreeRect[] = []
  for (const fr of freeList) {
    if (!intersects(fr, obstacle)) {
      result.push(fr)
      continue
    }
    if (obstacle.y > fr.y) {
      result.push({ x: fr.x, y: fr.y, width: fr.width, height: obstacle.y - fr.y })
    }
    if (obstacle.y + obstacle.height < fr.y + fr.height) {
      result.push({
        x: fr.x,
        y: obstacle.y + obstacle.height,
        width: fr.width,
        height: fr.y + fr.height - (obstacle.y + obstacle.height),
      })
    }
    if (obstacle.x > fr.x) {
      result.push({ x: fr.x, y: fr.y, width: obstacle.x - fr.x, height: fr.height })
    }
    if (obstacle.x + obstacle.width < fr.x + fr.width) {
      result.push({
        x: obstacle.x + obstacle.width,
        y: fr.y,
        width: fr.x + fr.width - (obstacle.x + obstacle.width),
        height: fr.height,
      })
    }
  }
  return removeDominated(result)
}

function removeDominated(rects: FreeRect[]): FreeRect[] {
  const result: FreeRect[] = []
  for (let i = 0; i < rects.length; i++) {
    let dominated = false
    for (let j = 0; j < rects.length; j++) {
      if (i === j) continue
      if (contains(rects[j], rects[i])) {
        dominated = true
        break
      }
    }
    if (!dominated) result.push(rects[i])
  }
  return result
}

function computeMaximalFreeRects(
  rolBreedte: number,
  rolLengte: number,
  plaatsingen: Placement[],
): FreeRect[] {
  let free: FreeRect[] = [{ x: 0, y: 0, width: rolBreedte, height: rolLengte }]
  for (const p of plaatsingen) {
    free = subtractRect(free, {
      x: p.positie_x_cm,
      y: p.positie_y_cm,
      width: p.lengte_cm,
      height: p.breedte_cm,
    })
  }
  return free
}

/**
 * Selecteer een disjoint set reststukken greedy: kies telkens de grootste
 * kwalificerende rechthoek, "claim" die, en gebruik hem als obstacle voor de
 * volgende iteratie. Stopt wanneer geen kwalificerende rechthoek meer over is.
 */
function greedyDisjointReststukken(
  rolBreedte: number,
  rolLengte: number,
  plaatsingen: Placement[],
  minShort: number,
  minLong: number,
): FreeRect[] {
  let free = computeMaximalFreeRects(rolBreedte, rolLengte, plaatsingen)
  const claimed: FreeRect[] = []

  while (true) {
    const kwalificerend = free.filter((r) => {
      const s = Math.min(r.width, r.height)
      const l = Math.max(r.width, r.height)
      return s >= minShort && l >= minLong
    })
    if (kwalificerend.length === 0) break

    // Grootste area eerst; bij gelijk area: langste zijde eerst (bruikbaarder).
    kwalificerend.sort((a, b) => {
      const areaA = a.width * a.height
      const areaB = b.width * b.height
      if (areaB !== areaA) return areaB - areaA
      const longA = Math.max(a.width, a.height)
      const longB = Math.max(b.width, b.height)
      return longB - longA
    })
    const pick = kwalificerend[0]
    claimed.push(pick)
    // Verwijder de claim uit de vrije ruimte voor de volgende iteratie.
    free = subtractRect(free, pick)
  }

  return claimed
}

export function computeReststukken(
  rolLengte: number,
  rolBreedte: number,
  plaatsingen: Placement[],
  minShort: number = RESTSTUK_MIN_SHORT,
  minLong: number = RESTSTUK_MIN_LONG,
): ReststukRect[] {
  if (plaatsingen.length === 0) {
    const full: ReststukRect = {
      x_cm: 0,
      y_cm: 0,
      breedte_cm: rolBreedte,
      lengte_cm: rolLengte,
    }
    return qualifies(full, minShort, minLong) ? [full] : []
  }

  const rects = greedyDisjointReststukken(rolBreedte, rolLengte, plaatsingen, minShort, minLong)
  return rects.map((r) => ({
    x_cm: r.x,
    y_cm: r.y,
    breedte_cm: r.width,
    lengte_cm: r.height,
  }))
}
