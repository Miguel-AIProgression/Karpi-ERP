// Guillotine-cut 2D strip-packing algorithm (parallel aan ffdh-packing).
//
// Achtergrond: FFDH-shelf-packing kan lokaal suboptimaal beslissen omdat het
// per stuk een tier-score hanteert die nieuwe shelves prefereert boven
// bestaande "onbruikbare gaten". Gevolg: grote reststukken ontstaan op een
// plek waar een volgend stuk prima in had gepast, en een nieuwe shelf wordt
// aangesneden. Zie changelog + docs/architectuur.md voor voorbeeld 2
// (IC2900VE16A).
//
// Guillotine-packing houdt vrije rechthoeken expliciet bij. Elk stuk wordt
// geplaatst in de best-passende vrije rechthoek en de overblijvende ruimte
// wordt met één guillotine-snit in 2 nieuwe rechthoeken gesplitst. Daardoor
// kan een klein stuk letterlijk "uit een groot reststuk worden gehaald" i.p.v.
// altijd vanaf de volle rol te starten.
//
// Referentie: Jylänki, "A Thousand Ways to Pack the Bin" (2010). We gebruiken
// **Best Area Fit** (BAF) voor selectie en **Short Axis Split** (SAS) voor
// splitsing. Deze combinatie levert in benchmarks consistent hoge benutting
// met grote samenhangende reststukken — precies wat Karpi nodig heeft.
//
// Publieke API is drop-in compatibel met ffdh-packing's `packAcrossRolls`.

import type {
  Placement,
  Roll,
  RollResult,
  SnijplanPiece,
  UnplacedPiece,
  PackOptions,
  PackingResult,
  Shelf,
} from './ffdh-packing.ts'
import {
  calcRollStats,
  sortRolls,
  packRoll as packRollFfdh,
  reconstructShelves,
} from './ffdh-packing.ts'

// ---------------------------------------------------------------------------
// Free rectangle tracking
// ---------------------------------------------------------------------------

export interface FreeRect {
  x: number       // positie langs rol-breedte (X)
  y: number       // positie langs rol-lengte (Y)
  width: number   // afmeting langs X (rol-breedte)
  height: number  // afmeting langs Y (rol-lengte)
}

/**
 * Reststuk-minima — synchroon met compute-reststukken.ts (edge-function én
 * frontend) en de bedrijfsregel dat kleinere stukken niet als herbruikbaar
 * reststuk bewaard worden. Deze module gebruikt ze voor scoring: placements
 * die grote samenhangende vrije rechthoeken achterlaten boven deze drempels
 * krijgen voorrang.
 *
 * Pas je deze waarden aan, wijzig dan óók:
 *   - supabase/functions/_shared/compute-reststukken.ts
 *   - frontend/src/lib/utils/compute-reststukken.ts
 *   - scripts/vergelijk-snijalgoritmes.mjs (benchmark)
 */
export const RESTSTUK_MIN_SHORT = 50
export const RESTSTUK_MIN_LONG = 100

/**
 * Minimale rol-rest om een rol nog als "aangebroken" terug te zetten. Blijft
 * er minder dan dit over na snijden, dan is de rol-rest feitelijk verspild
 * tenzij die rest zelf als reststuk kwalificeert (≥ RESTSTUK_MIN_SHORT ×
 * RESTSTUK_MIN_LONG). Synchroon met frontend `AANGEBROKEN_MIN_LENGTE` en de
 * UI-drempel in `rol-uitvoer-modal.tsx`.
 *
 * Gebruikt in placement-scoring: als een placement de rol-rest onder deze
 * drempel zou duwen, schakelen we over van "minimaliseer rol-verbruik" naar
 * "maximaliseer reststuk-m²" — want de rol gaat toch op, en dan telt elke
 * herbruikbare rest.
 */
export const AANGEBROKEN_MIN_LENGTE = 100

function qualifiesAsReststuk(fr: FreeRect): boolean {
  const short = Math.min(fr.width, fr.height)
  const long = Math.max(fr.width, fr.height)
  return short >= RESTSTUK_MIN_SHORT && long >= RESTSTUK_MIN_LONG
}

/** Som van oppervlak (cm²) van vrije rechthoeken die als reststuk kwalificeren. */
function reststukAreaCm2(freeRects: FreeRect[]): number {
  let total = 0
  for (const fr of freeRects) {
    if (qualifiesAsReststuk(fr)) total += fr.width * fr.height
  }
  return total
}

/** Check of twee rechthoeken overlappen (exclusief aangrenzend). */
function intersects(a: FreeRect, b: FreeRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

/** Check of rechthoek `inner` volledig binnen `outer` ligt. */
function contains(outer: FreeRect, inner: FreeRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

/**
 * Subtract `obstacle` uit een lijst vrije rechthoeken. Elke getroffen
 * rechthoek wordt in max 4 sub-rechthoeken gesplitst (top, bottom, left,
 * right) — de delen van de originele rechthoek die buiten de obstacle vallen.
 *
 * Gebruikt voor:
 * - Initiële vrije-ruimte-berekening uit bezette placements.
 * - Na plaatsing van een stuk: verwijder de bezette ruimte uit alle andere
 *   vrije rechthoeken die erop overlapten (niet alleen de gekozen rechthoek).
 */
function subtractRect(freeList: FreeRect[], obstacle: FreeRect): FreeRect[] {
  const result: FreeRect[] = []

  for (const fr of freeList) {
    if (!intersects(fr, obstacle)) {
      result.push(fr)
      continue
    }

    // Top (boven obstacle)
    if (obstacle.y > fr.y) {
      result.push({
        x: fr.x,
        y: fr.y,
        width: fr.width,
        height: obstacle.y - fr.y,
      })
    }
    // Bottom (onder obstacle)
    if (obstacle.y + obstacle.height < fr.y + fr.height) {
      result.push({
        x: fr.x,
        y: obstacle.y + obstacle.height,
        width: fr.width,
        height: fr.y + fr.height - (obstacle.y + obstacle.height),
      })
    }
    // Left (links van obstacle)
    if (obstacle.x > fr.x) {
      result.push({
        x: fr.x,
        y: fr.y,
        width: obstacle.x - fr.x,
        height: fr.height,
      })
    }
    // Right (rechts van obstacle)
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

/**
 * Verwijder rechthoeken die volledig binnen een andere rechthoek liggen —
 * die zijn redundant (elk stuk dat in een "dominated" rect past, past ook in
 * zijn dominator). Houdt de lijst klein en correct.
 */
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

/**
 * Bereken initiële vrije rechthoeken uit bezette plaatsingen. Start met de
 * volle rol en trek elke bezette placement eraf.
 */
export function computeFreeRects(
  rollWidth: number,
  rollLength: number,
  bezette: Placement[],
): FreeRect[] {
  let free: FreeRect[] = [
    { x: 0, y: 0, width: rollWidth, height: rollLength },
  ]
  for (const p of bezette) {
    free = subtractRect(free, {
      x: p.positie_x_cm,
      y: p.positie_y_cm,
      width: p.lengte_cm,
      height: p.breedte_cm,
    })
  }
  return free
}

// ---------------------------------------------------------------------------
// Placement selection
// ---------------------------------------------------------------------------

interface Candidate {
  freeIdx: number
  x: number
  y: number
  placedWidth: number   // afmeting langs X na eventuele rotatie
  placedHeight: number  // afmeting langs Y na eventuele rotatie
  rotated: boolean
  score: number
}

/**
 * Placement-selectie met dead-zone-aware lexicografische criteria.
 *
 * Voor elke kandidaat (orientatie × vrije rechthoek) simuleren we de
 * guillotine-split + het trimmen van aangrenzende vrije rechthoeken. Dan
 * vergelijken we in deze volgorde (eerst hogere prioriteit):
 *
 *   1. **Safe vs dead-zone** — `yEnd ≤ rolLengte − AANGEBROKEN_MIN_LENGTE`
 *      betekent er blijft na deze placement nog minstens 100 cm rol over
 *      voor een nieuw snijplan (rol blijft aanbreekbaar). "Safe" wint altijd
 *      van "dead" — we willen niet de rol opmaken als we nog zuinig kunnen
 *      zijn.
 *
 *   2. **Binnen safe-klasse: yEnd ↓** — rol-lengte zuinigheid is primair
 *      zolang er voldoende rol overblijft.
 *
 *   3. **Binnen dead-zone: reststuk-m² ↑** — als de rol-rest tóch te kort
 *      wordt (< 100 cm, niet meer aan te breken), dan schakelen we over op
 *      maximale reststuk-waarde. Dit voorkomt dat het algoritme 50 cm rol
 *      verspilt terwijl een iets hogere yEnd een 75×243 reststuk had
 *      opgeleverd. Dit is de kern van user's prioriteiten-hiërarchie:
 *      eerst minimaal rol-verbruik, maar als de rol toch opgaat, dan
 *      reststukken maximaal.
 *
 *   4. **Secondary: reststuk ↑ bij gelijk yEnd** — relevante tiebreaker
 *      in de safe-klasse waar meerdere placements dezelfde yEnd hebben.
 *
 *   5. **Best Area Fit** — kleinste gekozen free-rect eerst.
 *
 *   6. **Short-side leftover minimaal** — laatste tiebreaker.
 */
function findBestPlacement(
  piece: SnijplanPiece,
  freeRects: FreeRect[],
  rolLengte: number,
): Candidate | null {
  let best: Candidate | null = null
  let bestSafe = 2  // 0=safe, 1=dead; hoger is slechter
  let bestYEnd = Infinity
  let bestReststuk = -Infinity
  let bestFreeArea = Infinity
  let bestLeftoverShort = Infinity

  const deadZoneStart = rolLengte - AANGEBROKEN_MIN_LENGTE

  const orientations = [
    { w: piece.lengte_cm, h: piece.breedte_cm, rotated: false },
    { w: piece.breedte_cm, h: piece.lengte_cm, rotated: true },
  ]

  for (let i = 0; i < freeRects.length; i++) {
    const fr = freeRects[i]
    const freeArea = fr.width * fr.height
    for (const o of orientations) {
      if (o.w > fr.width || o.h > fr.height) continue

      const yEnd = fr.y + o.h
      const leftoverShort = Math.min(fr.width - o.w, fr.height - o.h)
      const safe = yEnd <= deadZoneStart ? 0 : 1

      // Simuleer de volledige free-rect-update om reststuk-oppervlak te meten.
      const splits = guillotineSplit(fr, o.w, o.h)
      const others = freeRects.filter((_, idx) => idx !== i)
      const obstacle: FreeRect = { x: fr.x, y: fr.y, width: o.w, height: o.h }
      const trimmed = subtractRect(others, obstacle)
      const newFree = removeDominated([...trimmed, ...splits])
      const reststukCm2 = reststukAreaCm2(newFree)

      // Lexicografische vergelijking per zone:
      //   safe-zone: [safe ↓, yEnd ↓, reststuk ↑, freeArea ↓, leftoverShort ↓]
      //   dead-zone: [safe ↓ (dus eerst safe), reststuk ↑, yEnd ↓, ...]
      let better = false
      if (safe !== bestSafe) {
        better = safe < bestSafe
      } else if (safe === 0) {
        // Beide safe: rol-zuinigheid primair, reststuk secundair
        better =
          yEnd < bestYEnd ||
          (yEnd === bestYEnd && reststukCm2 > bestReststuk) ||
          (yEnd === bestYEnd && reststukCm2 === bestReststuk && freeArea < bestFreeArea) ||
          (yEnd === bestYEnd && reststukCm2 === bestReststuk && freeArea === bestFreeArea &&
            leftoverShort < bestLeftoverShort)
      } else {
        // Beide dead-zone: reststuk primair, dan zuinigheid, dan BAF
        better =
          reststukCm2 > bestReststuk ||
          (reststukCm2 === bestReststuk && yEnd < bestYEnd) ||
          (reststukCm2 === bestReststuk && yEnd === bestYEnd && freeArea < bestFreeArea) ||
          (reststukCm2 === bestReststuk && yEnd === bestYEnd && freeArea === bestFreeArea &&
            leftoverShort < bestLeftoverShort)
      }

      if (best === null || better) {
        bestSafe = safe
        bestYEnd = yEnd
        bestReststuk = reststukCm2
        bestFreeArea = freeArea
        bestLeftoverShort = leftoverShort
        best = {
          freeIdx: i,
          x: fr.x,
          y: fr.y,
          placedWidth: o.w,
          placedHeight: o.h,
          rotated: o.rotated,
          score: yEnd,
        }
      }
    }
  }

  return best
}

// ---------------------------------------------------------------------------
// Guillotine split
// ---------------------------------------------------------------------------

/**
 * Splits de gekozen vrije rechthoek in maximaal 2 nieuwe rechthoeken na
 * plaatsing van een stuk linksboven in de rechthoek.
 *
 * Twee snitkeuzes (beide zijn geldig in productie — tapijt kan in elke
 * richting gesneden worden zolang het één rechte snit is):
 *
 *   Horizontaal (snit op y = y + placedHeight):
 *     ┌──────────┬──────┐       ┌──────────┬──────┐
 *     │ PLACED   │ R    │  →    │ PLACED   │ R    │  (right)
 *     ├──────────┴──────┤       ├──────────┴──────┤
 *     │                 │       │     B           │  (bottom, volle breedte)
 *     └─────────────────┘       └─────────────────┘
 *
 *   Verticaal (snit op x = x + placedWidth):
 *     ┌──────────┬──────┐       ┌──────────┬──────┐
 *     │ PLACED   │      │       │ PLACED   │      │
 *     ├──────────┤  R   │  →    ├──────────┤  R   │  (right, volle hoogte)
 *     │   B      │      │       │   B      │      │  (bottom onder placed alleen)
 *     └──────────┴──────┘       └──────────┴──────┘
 *
 * Short Axis Split (SAS): splits langs de korte-as van het restant, zodat de
 * lange-as intact blijft. Dat produceert één lang reststuk + één klein stuk,
 * wat in Karpi's context het gewenste gedrag is (grote bruikbare reststukken).
 */
function guillotineSplit(fr: FreeRect, placedW: number, placedH: number): FreeRect[] {
  const rightW = fr.width - placedW
  const bottomH = fr.height - placedH
  const rects: FreeRect[] = []

  // SAS: als het restant-rechts (langs X) smaller is dan restant-onder (langs Y),
  // splitsen we horizontaal (de onder-strip pakt de volle breedte). Dat houdt
  // de lange Y-as van de onder-strip intact.
  const splitHorizontal = rightW < bottomH

  if (splitHorizontal) {
    // Right strip (naast placed, alleen zo hoog als placed):
    if (rightW > 0 && placedH > 0) {
      rects.push({
        x: fr.x + placedW,
        y: fr.y,
        width: rightW,
        height: placedH,
      })
    }
    // Bottom strip (volle breedte, onder placed):
    if (bottomH > 0 && fr.width > 0) {
      rects.push({
        x: fr.x,
        y: fr.y + placedH,
        width: fr.width,
        height: bottomH,
      })
    }
  } else {
    // Right strip (naast placed, volle hoogte):
    if (rightW > 0 && fr.height > 0) {
      rects.push({
        x: fr.x + placedW,
        y: fr.y,
        width: rightW,
        height: fr.height,
      })
    }
    // Bottom strip (onder placed, alleen placed-breed):
    if (bottomH > 0 && placedW > 0) {
      rects.push({
        x: fr.x,
        y: fr.y + placedH,
        width: placedW,
        height: bottomH,
      })
    }
  }

  return rects
}

// ---------------------------------------------------------------------------
// Single-roll packing
// ---------------------------------------------------------------------------

/**
 * Pack een lijst stukken op één rol met Guillotine-cut algoritme.
 *
 * `initialFree` bevat de vrije rechthoeken bij start. Voor een lege rol is
 * dat één rechthoek {0,0,W,H}; voor een rol met bezette placements levert
 * `computeFreeRects(W, H, placements)` de juiste startset.
 *
 * `rolLengte` wordt expliciet meegegeven zodat `findBestPlacement` de
 * dead-zone grens (rolLengte − AANGEBROKEN_MIN_LENGTE) kan bepalen. Impliciet
 * uit initialFree halen werkt niet voor rollen met bezette placements: dan is
 * er geen free-rect die de volle rol-lengte bestrijkt.
 */
export function packRollGuillotine(
  pieces: SnijplanPiece[],
  initialFree: FreeRect[],
  rolLengte: number,
): { placed: Placement[]; remaining: SnijplanPiece[] } {
  let free = initialFree.map((r) => ({ ...r }))
  const placed: Placement[] = []
  const remaining: SnijplanPiece[] = []

  for (const piece of pieces) {
    const best = findBestPlacement(piece, free, rolLengte)
    if (!best) {
      remaining.push(piece)
      continue
    }

    placed.push({
      snijplan_id: piece.id,
      positie_x_cm: best.x,
      positie_y_cm: best.y,
      lengte_cm: best.placedWidth,
      breedte_cm: best.placedHeight,
      geroteerd: best.rotated,
    })

    const chosen = free[best.freeIdx]
    const splits = guillotineSplit(chosen, best.placedWidth, best.placedHeight)

    // Ook andere vrije rechthoeken kunnen overlappen met het geplaatste stuk;
    // die worden getrimd met de placed-rect als obstacle zodat ze geen ruimte
    // bevatten die nu bezet is.
    const others = free.filter((_, idx) => idx !== best.freeIdx)
    const obstacle: FreeRect = {
      x: best.x,
      y: best.y,
      width: best.placedWidth,
      height: best.placedHeight,
    }
    const trimmed = subtractRect(others, obstacle)

    free = removeDominated([...trimmed, ...splits])
  }

  return { placed, remaining }
}

// ---------------------------------------------------------------------------
// Piece sorting (zelfde strategie als FFDH: grootste-eerst)
// ---------------------------------------------------------------------------

/**
 * Sorteer stukken: grootste dimensie eerst, dan grootste oppervlak, dan
 * afleverdatum. Identiek aan FFDH's sortPieces — zodat we regressie tegen
 * FFDH-gedrag bewust alleen door het plaatsings-algoritme sturen, niet door
 * volgorde-verschillen.
 */
function sortPieces(pieces: SnijplanPiece[]): SnijplanPiece[] {
  const vandaag = new Date().toISOString().slice(0, 10)
  return [...pieces].sort((a, b) => {
    const maxA = Math.max(a.lengte_cm, a.breedte_cm)
    const maxB = Math.max(b.lengte_cm, b.breedte_cm)
    if (maxB !== maxA) return maxB - maxA
    if (b.area_cm2 !== a.area_cm2) return b.area_cm2 - a.area_cm2
    const dateA = a.afleverdatum ?? vandaag
    const dateB = b.afleverdatum ?? vandaag
    if (dateA !== dateB) return dateA < dateB ? -1 : 1
    const nullA = a.afleverdatum == null ? 1 : 0
    const nullB = b.afleverdatum == null ? 1 : 0
    return nullA - nullB
  })
}

// ---------------------------------------------------------------------------
// Per-roll scoring: kies tussen Guillotine en FFDH uitkomst
// ---------------------------------------------------------------------------

/**
 * Score een packing-resultaat voor keuze tussen algoritmes. Lager = beter.
 *
 * Primair: meer stukken geplaatst (weegt het zwaarst — niet-geplaatste
 * stukken zijn een systeemfalen, dat overstijgt alle andere criteria).
 * Secundair: minder rol-lengte gebruikt (directe materiaalbesparing).
 * Tertiair: meer bruikbaar reststuk-oppervlak (m² dat als reststuk
 * herbruikbaar blijft i.p.v. afval wordt).
 * Quartair: lager afval-percentage (interne ruimte-benutting).
 *
 * Reststuk telt met gewicht 100 per m²: dat is ongeveer gelijk aan 1% afval
 * — substantieel genoeg om bij gelijke rol-lengte het plan met meer
 * reststuk-waarde te laten winnen, maar niet zo dominant dat het een extra
 * rol-lengte van 100+ cm rechtvaardigt (want dan snijd je juist meer rol
 * aan om reststuk-waarde te forceren).
 */
function scorePacking(
  placedCount: number,
  stats: {
    gebruikte_lengte_cm: number
    afval_percentage: number
    reststuk_m2: number
  },
): number {
  const maxPlaced = 10_000
  const notPlacedPenalty = (maxPlaced - placedCount) * 1e12
  return (
    notPlacedPenalty +
    stats.gebruikte_lengte_cm * 1e4 +
    stats.afval_percentage -
    stats.reststuk_m2 * 100
  )
}

// ---------------------------------------------------------------------------
// Multi-roll orchestration (drop-in replacement voor FFDH packAcrossRolls)
// ---------------------------------------------------------------------------

/**
 * Pack stukken over meerdere rollen — combineert Guillotine en FFDH per rol
 * en kiest per rol het beste resultaat.
 *
 * Waarom best-of-both: Guillotine wint overtuigend op scenarios waar kleine
 * stukken uit grote "reststuk-achtige" vrije ruimtes gehaald moeten worden
 * (voorbeeld 2, stress-tests) maar kan suboptimaal zijn op lange smalle
 * rollen met lange smalle stukken (FFDH's shelf-aanpak met rotatie-lookahead
 * pakt dat soort patronen beter op). Door beide te runnen en per rol het
 * beste te kiezen, winnen we de problematische gevallen zonder regressies.
 *
 * Keuze-criterium per rol: (a) meeste stukken geplaatst, (b) kleinste
 * gebruikte rol-lengte, (c) laagste afval-percentage. Bij volkomen gelijk
 * spel valt de keuze op Guillotine (consistenter gedrag voor samengestelde
 * reststukken).
 *
 * Publieke API is compatibel met ffdh-packing.packAcrossRolls — consumenten
 * kunnen wisselen door enkel de import-regel te veranderen.
 */
export function packAcrossRolls(
  pieces: SnijplanPiece[],
  rolls: Roll[],
  pieceVormMap: Map<number, string | null>,
  options: PackOptions = {},
): PackingResult {
  const { bezetteMap, maxReststukVerspillingPct } = options
  const sortedPieces = sortPieces(pieces)
  const sortedRolls = sortRolls(rolls)

  let unplacedPieces = [...sortedPieces]
  const rollResults: RollResult[] = []

  for (const roll of sortedRolls) {
    if (unplacedPieces.length === 0) break

    const bezettePlaatsingen = bezetteMap?.get(roll.id) ?? []

    // --- Guillotine poging ---
    const initialFree = computeFreeRects(
      roll.breedte_cm,
      roll.lengte_cm,
      bezettePlaatsingen,
    )
    const guil = packRollGuillotine(unplacedPieces, initialFree, roll.lengte_cm)
    const guilAllPlacements = [...bezettePlaatsingen, ...guil.placed]
    const guilStats = calcRollStats(
      guilAllPlacements,
      roll.breedte_cm,
      roll.lengte_cm,
      pieceVormMap,
    )
    const guilReststukM2 = reststukAreaCm2(
      computeFreeRects(roll.breedte_cm, roll.lengte_cm, guilAllPlacements),
    ) / 10000

    // --- FFDH poging ---
    const initialShelves: Shelf[] = reconstructShelves(bezettePlaatsingen, roll.breedte_cm)
    const ffdh = packRollFfdh(
      unplacedPieces,
      roll.breedte_cm,
      roll.lengte_cm,
      initialShelves,
    )
    const ffdhAllPlacements = [...bezettePlaatsingen, ...ffdh.placed]
    const ffdhStats = calcRollStats(
      ffdhAllPlacements,
      roll.breedte_cm,
      roll.lengte_cm,
      pieceVormMap,
    )
    const ffdhReststukM2 = reststukAreaCm2(
      computeFreeRects(roll.breedte_cm, roll.lengte_cm, ffdhAllPlacements),
    ) / 10000

    // --- Kies beste per rol (inclusief reststuk-m² in de score) ---
    const guilScore = scorePacking(guil.placed.length, {
      ...guilStats,
      reststuk_m2: guilReststukM2,
    })
    const ffdhScore = scorePacking(ffdh.placed.length, {
      ...ffdhStats,
      reststuk_m2: ffdhReststukM2,
    })
    const useGuil = guilScore <= ffdhScore

    const chosen = useGuil
      ? { placed: guil.placed, remaining: guil.remaining, stats: guilStats }
      : { placed: ffdh.placed, remaining: ffdh.remaining, stats: ffdhStats }

    if (chosen.placed.length === 0) continue

    if (
      roll.status === 'reststuk' &&
      maxReststukVerspillingPct !== undefined &&
      chosen.stats.afval_percentage > maxReststukVerspillingPct
    ) {
      continue
    }

    rollResults.push({
      rol_id: roll.id,
      rolnummer: roll.rolnummer,
      rol_lengte_cm: roll.lengte_cm,
      rol_breedte_cm: roll.breedte_cm,
      rol_status: roll.status,
      plaatsingen: chosen.placed,
      ...chosen.stats,
    })
    unplacedPieces = chosen.remaining
  }

  const nietGeplaatst: UnplacedPiece[] = unplacedPieces.map((p) => ({
    snijplan_id: p.id,
    reden: 'Geen rol met voldoende ruimte',
  }))

  const totaalGeplaatst = rollResults.reduce((sum, r) => sum + r.plaatsingen.length, 0)
  const totaalM2Gebruikt = rollResults.reduce(
    (sum, r) => sum + (r.rol_breedte_cm * r.gebruikte_lengte_cm) / 10000, 0,
  )
  const totaalM2Afval = rollResults.reduce(
    (sum, r) => sum + (r.rol_breedte_cm * r.gebruikte_lengte_cm) / 10000 * (r.afval_percentage / 100), 0,
  )
  const gemiddeldAfvalPct = rollResults.length > 0
    ? Math.round((rollResults.reduce((s, r) => s + r.afval_percentage, 0) / rollResults.length) * 10) / 10
    : 0

  return {
    rollResults,
    nietGeplaatst,
    samenvatting: {
      totaal_stukken: pieces.length,
      geplaatst: totaalGeplaatst,
      niet_geplaatst: nietGeplaatst.length,
      totaal_rollen: rollResults.length,
      gemiddeld_afval_pct: gemiddeldAfvalPct,
      totaal_m2_gebruikt: Math.round(totaalM2Gebruikt * 10) / 10,
      totaal_m2_afval: Math.round(totaalM2Afval * 10) / 10,
    },
  }
}

// ---------------------------------------------------------------------------
// Reststuk-berekening (na packing)
// ---------------------------------------------------------------------------

/**
 * Bereken bruikbare reststukken uit een guillotine-layout. Anders dan de
 * FFDH-variant (shelf-reconstructie) is dit een directe aflezing van de vrije
 * rechthoeken: start met volle rol en trek alle plaatsingen eraf.
 *
 * Filter: minShort (default 50) op korte zijde, minLong (default 100) op lange.
 */
export function computeReststukkenGuillotine(
  rolBreedte: number,
  rolLengte: number,
  plaatsingen: Placement[],
  minShort = 50,
  minLong = 100,
): FreeRect[] {
  const free = computeFreeRects(rolBreedte, rolLengte, plaatsingen)
  return free.filter((r) => {
    const short = Math.min(r.width, r.height)
    const long = Math.max(r.width, r.height)
    return short >= minShort && long >= minLong
  })
}
