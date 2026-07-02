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

// Reststuk-/aanbreek-drempels: één bron (ADR-0033). Re-export zodat bestaande
// importeurs van deze module (incl. de frontend re-export-shim) ongewijzigd
// blijven werken.
import { RESTSTUK_MIN_SHORT, RESTSTUK_MIN_LONG, AANGEBROKEN_MIN_LENGTE } from './reststuk-config.ts'
export { RESTSTUK_MIN_SHORT, RESTSTUK_MIN_LONG, AANGEBROKEN_MIN_LENGTE } from './reststuk-config.ts'

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
 * Shape-biased score (ADR-0025): `area × √(short/long)`. Synchroon met
 * `_shared/guillotine-packing.ts::reststukScoreCm2`. Pure m² is shape-blind —
 * een 150×450 (verkoopbaar tapijt) en 75×905 (alleen staaltjes-bruikbaar)
 * scoren bij gelijke area gelijk, waardoor greedy onbedoeld de langste-smalste
 * strip claimt. De wortel-weighting prefereert chunkier vormen zonder
 * smalle strips weg te schrijven.
 */
function reststukScore(r: FreeRect): number {
  const short = Math.min(r.width, r.height)
  const long = Math.max(r.width, r.height)
  return r.width * r.height * Math.sqrt(short / long)
}

/**
 * Selecteer een disjoint set reststukken greedy: kies telkens de
 * kwalificerende rechthoek met de hoogste shape-biased score, "claim" die,
 * en gebruik hem als obstacle voor de volgende iteratie. Stopt wanneer geen
 * kwalificerende rechthoek meer over is.
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

    // Hoogste score eerst (ADR-0025); bij gelijke score: grootste area als
    // stabiele tiebreaker (volgt de oude pure-area volgorde voor edge-cases).
    kwalificerend.sort((a, b) => {
      const sa = reststukScore(a)
      const sb = reststukScore(b)
      if (sb !== sa) return sb - sa
      return b.width * b.height - a.width * a.height
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
  plaatsingen: Placement[],
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

/**
 * Minimale geometrie die een "stuk op de rol" nodig heeft om als plaatsing
 * mee te tellen. Bewust losser dan `Placement`/de frontend `SnijStuk` (die
 * ook order-/klant-metadata draagt) — puur de vijf velden die de
 * reststuk-geometrie nodig heeft, zodat callers een rijker domein-object
 * kunnen doorgeven zonder eerst te mappen.
 */
export interface StukGeometrie {
  snijplan_id?: number | null
  x_cm: number
  y_cm: number
  lengte_cm: number
  breedte_cm: number
  geroteerd?: boolean
}

function naarPlaatsingen(stukken: StukGeometrie[]): Placement[] {
  return stukken.map((s) => ({
    snijplan_id: s.snijplan_id ?? 0,
    positie_x_cm: s.x_cm,
    positie_y_cm: s.y_cm,
    lengte_cm: s.lengte_cm,
    breedte_cm: s.breedte_cm,
    geroteerd: s.geroteerd ?? false,
  }))
}

/** Convenience: bereken reststukken direct uit een array "stukken op de rol". */
export function computeReststukkenFromStukken(
  rolLengte: number,
  rolBreedte: number,
  stukken: StukGeometrie[],
  minShort: number = RESTSTUK_MIN_SHORT,
  minLong: number = RESTSTUK_MIN_LONG,
): ReststukRect[] {
  return computeReststukken(rolLengte, rolBreedte, naarPlaatsingen(stukken), minShort, minLong)
}

/** Convenience: reststukken + afval direct uit een array "stukken op de rol". */
export function computeReststukkenEnAfvalFromStukken(
  rolLengte: number,
  rolBreedte: number,
  stukken: StukGeometrie[],
  minShort: number = RESTSTUK_MIN_SHORT,
  minLong: number = RESTSTUK_MIN_LONG,
): { reststukken: ReststukRect[]; afval: ReststukRect[] } {
  return computeReststukkenEnAfval(rolLengte, rolBreedte, naarPlaatsingen(stukken), minShort, minLong)
}

// AANGEBROKEN_MIN_LENGTE (boven geïmporteerd uit ./reststuk-config.ts,
// ADR-0033): minimale lengte (cm) voor een bruikbare aangebroken rol. Full-width
// end-strips korter dan deze waarde zijn niet aan te breken (het volgende
// snijplan zou er geen zinvol stuk uit kunnen halen) — die worden als reststuk
// geclassificeerd zolang ze voldoen aan RESTSTUK_MIN_SHORT × RESTSTUK_MIN_LONG,
// en anders als afval. Synchroon met `rol-uitvoer-modal.tsx` (aangebrokenLengte).

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
  stukken: StukGeometrie[],
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
