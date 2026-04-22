// Bereken bruikbare reststukken uit een snijplan-layout.
// Frontend-kopie van supabase/functions/_shared/compute-reststukken.ts
// (Deno-specifieke imports kunnen niet in Vite-bundle; logica is identiek.)
//
// Strategie: free-rect subtraction + greedy disjoint cover. Zie edge-kant voor
// achtergrond. De oudere shelf-based benadering miste interne gaps; deze
// versie matcht wat het placement-algoritme "ziet" als reststuk-m².

import type { ReststukRect, SnijvoorstelPlaatsing, SnijStuk } from '@/lib/types/productie'

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
  plaatsingen: SnijvoorstelPlaatsing[],
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
 * Greedy disjoint: kies grootste kwalificerende rechthoek, claim hem,
 * gebruik als obstacle voor volgende iteratie. Voorkomt dat overlappende
 * maximal-rectangles als losse reststukken worden geteld.
 */
function greedyDisjointReststukken(
  rolBreedte: number,
  rolLengte: number,
  plaatsingen: SnijvoorstelPlaatsing[],
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
    free = subtractRect(free, pick)
  }
  return claimed
}

export function computeReststukken(
  rolLengte: number,
  rolBreedte: number,
  plaatsingen: SnijvoorstelPlaatsing[],
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

/**
 * Variant die ook afval-rechthoeken teruggeeft: alle resterende vrije ruimte
 * die NIET als reststuk kwalificeert.
 *
 * Implementatie: claim eerst alle reststukken via greedy, dan wat overblijft
 * in de maximal free-rects = afval. Dat geeft een samenhangend beeld: som van
 * reststuk-area + afval-area = totale vrije rol-area.
 */
export function computeReststukkenEnAfval(
  rolLengte: number,
  rolBreedte: number,
  plaatsingen: SnijvoorstelPlaatsing[],
  minShort: number = RESTSTUK_MIN_SHORT,
  minLong: number = RESTSTUK_MIN_LONG,
): { reststukken: ReststukRect[]; afval: ReststukRect[] } {
  if (plaatsingen.length === 0) {
    const full: ReststukRect = { x_cm: 0, y_cm: 0, breedte_cm: rolBreedte, lengte_cm: rolLengte }
    if (qualifies(full, minShort, minLong)) return { reststukken: [full], afval: [] }
    return { reststukken: [], afval: [full] }
  }
  const reststukRects = greedyDisjointReststukken(rolBreedte, rolLengte, plaatsingen, minShort, minLong)
  // Afval = maximal free rects minus geclaimde reststukken.
  let afvalFree = computeMaximalFreeRects(rolBreedte, rolLengte, plaatsingen)
  for (const claim of reststukRects) {
    afvalFree = subtractRect(afvalFree, claim)
  }
  const reststukken = reststukRects.map((r) => ({
    x_cm: r.x, y_cm: r.y, breedte_cm: r.width, lengte_cm: r.height,
  }))
  const afval: ReststukRect[] = afvalFree
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ x_cm: r.x, y_cm: r.y, breedte_cm: r.width, lengte_cm: r.height }))
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
 * Minimale lengte voor een bruikbare aangebroken rol. Full-width end-strips
 * korter dan deze waarde zijn niet aan te breken (want het volgende snijplan
 * zou er geen zinvol stuk uit kunnen halen) — die worden daarom als reststuk
 * geclassificeerd zolang ze voldoen aan RESTSTUK_MIN_SHORT × RESTSTUK_MIN_LONG,
 * en anders als afval. Synchroon met `rol-uitvoer-modal.tsx` (aangebrokenLengte).
 */
export const AANGEBROKEN_MIN_LENGTE = 100

/**
 * Splitst de analyse verder: end-of-roll strip met volle breedte wordt als
 * "aangebrokenEnd" apart teruggegeven (de originele rol krijgt dan een
 * verkorte lengte — zie `voltooi_snijplan_rol(p_aangebroken_lengte)`) MITS
 * lang genoeg om de rol opnieuw aan te breken (≥ AANGEBROKEN_MIN_LENGTE).
 * Kortere full-width strips gaan als normaal reststuk door (met eigen rolnummer
 * en sticker), zodat ze niet "verloren" gaan in een dode zone tussen reststuk
 * en aangebroken-rol.
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
    const aanbreekbaar = r.lengte_cm >= AANGEBROKEN_MIN_LENGTE
    if (isFullWidthEnd && aanbreekbaar && !aangebrokenEnd) {
      aangebrokenEnd = { y_cm: r.y_cm, breedte_cm: r.breedte_cm, lengte_cm: r.lengte_cm }
    } else {
      reststukken.push(r)
    }
  }
  return { reststukken, aangebrokenEnd, afval }
}
