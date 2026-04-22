#!/usr/bin/env node
// Vergelijk FFDH (huidig) vs Guillotine (nieuw) op snijplan-scenario's.
//
// Runt beide algoritmes op dezelfde input en print metrics side-by-side.
// Scenario's zijn handmatig gekozen: voorbeeld 2 (IC2900VE16A), user-spec,
// en een reeks edge cases. Doel: bewijs dat Guillotine minstens gelijkwaardig
// is en in problematische cases (voorbeeld 2) strikt beter.
//
// Gebruik:
//   node scripts/vergelijk-snijalgoritmes.mjs
//
// De algoritmes zijn inline geport van supabase/functions/_shared/ zodat dit
// script geen Deno / TypeScript-compilatie nodig heeft.

// ===========================================================================
// FFDH implementatie (1:1 port van supabase/functions/_shared/ffdh-packing.ts)
// ===========================================================================

function ffdh_gapIsUseful(gapWidth, shelfHeight, futurePieces) {
  return futurePieces.some(p =>
    (p.lengte_cm <= gapWidth && p.breedte_cm <= shelfHeight) ||
    (p.breedte_cm <= gapWidth && p.lengte_cm <= shelfHeight)
  )
}

function ffdh_tryPlacePiece(piece, shelves, rollWidth, rollLength, futurePieces) {
  const orientations = [
    { w: piece.lengte_cm, h: piece.breedte_cm, rotated: false },
    { w: piece.breedte_cm, h: piece.lengte_cm, rotated: true },
  ]
  let best = null
  let bestTier = Infinity
  let bestHeightWaste = Infinity
  let bestWidthWaste = Infinity

  for (const o of orientations) {
    if (o.w > rollWidth) continue
    for (const shelf of shelves) {
      if (o.h <= shelf.height && shelf.usedWidth + o.w <= shelf.maxWidth) {
        const rem = shelf.maxWidth - shelf.usedWidth - o.w
        const hw = shelf.height - o.h
        const tier = rem === 0 ? 0 : ffdh_gapIsUseful(rem, shelf.height, futurePieces) ? 1 : 3
        if (tier < bestTier || (tier === bestTier && hw < bestHeightWaste) ||
            (tier === bestTier && hw === bestHeightWaste && rem < bestWidthWaste)) {
          bestTier = tier; bestHeightWaste = hw; bestWidthWaste = rem
          best = { snijplan_id: piece.id, positie_x_cm: shelf.usedWidth, positie_y_cm: shelf.y,
                   lengte_cm: o.w, breedte_cm: o.h, geroteerd: o.rotated }
        }
      }
    }
    const total = shelves.reduce((s, sh) => Math.max(s, sh.y + sh.height), 0)
    if (total + o.h <= rollLength && o.w <= rollWidth) {
      const rem = rollWidth - o.w
      const tier = rem === 0 ? 0 : ffdh_gapIsUseful(rem, o.h, futurePieces) ? 2 : 4
      if (tier < bestTier || (tier === bestTier && 0 < bestHeightWaste) ||
          (tier === bestTier && 0 === bestHeightWaste && rem < bestWidthWaste)) {
        bestTier = tier; bestHeightWaste = 0; bestWidthWaste = rem
        best = { snijplan_id: piece.id, positie_x_cm: 0, positie_y_cm: total,
                 lengte_cm: o.w, breedte_cm: o.h, geroteerd: o.rotated }
      }
    }
  }
  return best
}

function ffdh_packRoll(pieces, rollWidth, rollLength) {
  const shelves = []
  const placed = []
  const remaining = []
  const placedIds = new Set()
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]
    const future = pieces.slice(i + 1).filter(p => !placedIds.has(p.id))
    const p = ffdh_tryPlacePiece(piece, shelves, rollWidth, rollLength, future)
    if (p) {
      placed.push(p); placedIds.add(piece.id)
      const existing = shelves.find(s => s.y === p.positie_y_cm)
      if (existing) existing.usedWidth += p.lengte_cm
      else shelves.push({ y: p.positie_y_cm, height: p.breedte_cm, usedWidth: p.lengte_cm, maxWidth: rollWidth })
    } else remaining.push(piece)
  }
  return { placed, remaining }
}

// ===========================================================================
// Guillotine implementatie (1:1 port van guillotine-packing.ts)
// ===========================================================================

function guil_intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
         a.y < b.y + b.height && a.y + a.height > b.y
}

function guil_contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y &&
         inner.x + inner.width <= outer.x + outer.width &&
         inner.y + inner.height <= outer.y + outer.height
}

function guil_subtractRect(freeList, obstacle) {
  const result = []
  for (const fr of freeList) {
    if (!guil_intersects(fr, obstacle)) { result.push(fr); continue }
    if (obstacle.y > fr.y)
      result.push({ x: fr.x, y: fr.y, width: fr.width, height: obstacle.y - fr.y })
    if (obstacle.y + obstacle.height < fr.y + fr.height)
      result.push({ x: fr.x, y: obstacle.y + obstacle.height, width: fr.width,
                    height: fr.y + fr.height - (obstacle.y + obstacle.height) })
    if (obstacle.x > fr.x)
      result.push({ x: fr.x, y: fr.y, width: obstacle.x - fr.x, height: fr.height })
    if (obstacle.x + obstacle.width < fr.x + fr.width)
      result.push({ x: obstacle.x + obstacle.width, y: fr.y,
                    width: fr.x + fr.width - (obstacle.x + obstacle.width), height: fr.height })
  }
  return guil_removeDominated(result)
}

function guil_removeDominated(rects) {
  const result = []
  for (let i = 0; i < rects.length; i++) {
    let dom = false
    for (let j = 0; j < rects.length; j++) {
      if (i === j) continue
      if (guil_contains(rects[j], rects[i])) { dom = true; break }
    }
    if (!dom) result.push(rects[i])
  }
  return result
}

function guil_computeFreeRects(rollWidth, rollLength, bezette) {
  let free = [{ x: 0, y: 0, width: rollWidth, height: rollLength }]
  for (const p of bezette) {
    free = guil_subtractRect(free, {
      x: p.positie_x_cm, y: p.positie_y_cm, width: p.lengte_cm, height: p.breedte_cm
    })
  }
  return free
}

const RESTSTUK_MIN_SHORT = 50
const RESTSTUK_MIN_LONG = 100
const AANGEBROKEN_MIN_LENGTE = 100

function guil_qualifiesAsReststuk(fr) {
  const short = Math.min(fr.width, fr.height)
  const long = Math.max(fr.width, fr.height)
  return short >= RESTSTUK_MIN_SHORT && long >= RESTSTUK_MIN_LONG
}

function guil_reststukAreaCm2(freeRects) {
  let total = 0
  for (const fr of freeRects) {
    if (guil_qualifiesAsReststuk(fr)) total += fr.width * fr.height
  }
  return total
}

function guil_findBestPlacement(piece, freeRects, rolLengte) {
  let best = null
  let bestSafe = 2
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

      const splits = guil_guillotineSplit(fr, o.w, o.h)
      const others = freeRects.filter((_, idx) => idx !== i)
      const obstacle = { x: fr.x, y: fr.y, width: o.w, height: o.h }
      const trimmed = guil_subtractRect(others, obstacle)
      const newFree = guil_removeDominated([...trimmed, ...splits])
      const reststukCm2 = guil_reststukAreaCm2(newFree)

      // Dead-zone aware lexico:
      //   safe ↓ primair. Binnen safe: yEnd ↓, reststuk ↑.
      //   Binnen dead: reststuk ↑, yEnd ↓.
      let better = false
      if (safe !== bestSafe) {
        better = safe < bestSafe
      } else if (safe === 0) {
        better =
          yEnd < bestYEnd ||
          (yEnd === bestYEnd && reststukCm2 > bestReststuk) ||
          (yEnd === bestYEnd && reststukCm2 === bestReststuk && freeArea < bestFreeArea) ||
          (yEnd === bestYEnd && reststukCm2 === bestReststuk && freeArea === bestFreeArea && leftoverShort < bestLeftoverShort)
      } else {
        better =
          reststukCm2 > bestReststuk ||
          (reststukCm2 === bestReststuk && yEnd < bestYEnd) ||
          (reststukCm2 === bestReststuk && yEnd === bestYEnd && freeArea < bestFreeArea) ||
          (reststukCm2 === bestReststuk && yEnd === bestYEnd && freeArea === bestFreeArea && leftoverShort < bestLeftoverShort)
      }

      if (best === null || better) {
        bestSafe = safe
        bestYEnd = yEnd
        bestReststuk = reststukCm2
        bestFreeArea = freeArea
        bestLeftoverShort = leftoverShort
        best = { freeIdx: i, x: fr.x, y: fr.y, placedWidth: o.w, placedHeight: o.h,
                 rotated: o.rotated, score: yEnd }
      }
    }
  }
  return best
}

function guil_guillotineSplit(fr, placedW, placedH) {
  const rightW = fr.width - placedW
  const bottomH = fr.height - placedH
  const rects = []
  const splitHorizontal = rightW < bottomH
  if (splitHorizontal) {
    if (rightW > 0 && placedH > 0)
      rects.push({ x: fr.x + placedW, y: fr.y, width: rightW, height: placedH })
    if (bottomH > 0 && fr.width > 0)
      rects.push({ x: fr.x, y: fr.y + placedH, width: fr.width, height: bottomH })
  } else {
    if (rightW > 0 && fr.height > 0)
      rects.push({ x: fr.x + placedW, y: fr.y, width: rightW, height: fr.height })
    if (bottomH > 0 && placedW > 0)
      rects.push({ x: fr.x, y: fr.y + placedH, width: placedW, height: bottomH })
  }
  return rects
}

function guil_packRoll(pieces, rollWidth, rollLength, initialFree) {
  let free = initialFree.map(r => ({ ...r }))
  const placed = []
  const remaining = []
  for (const piece of pieces) {
    const best = guil_findBestPlacement(piece, free, rollLength)
    if (!best) { remaining.push(piece); continue }
    placed.push({ snijplan_id: piece.id, positie_x_cm: best.x, positie_y_cm: best.y,
                  lengte_cm: best.placedWidth, breedte_cm: best.placedHeight, geroteerd: best.rotated })
    const chosen = free[best.freeIdx]
    const splits = guil_guillotineSplit(chosen, best.placedWidth, best.placedHeight)
    const others = free.filter((_, idx) => idx !== best.freeIdx)
    const obstacle = { x: best.x, y: best.y, width: best.placedWidth, height: best.placedHeight }
    const trimmed = guil_subtractRect(others, obstacle)
    free = guil_removeDominated([...trimmed, ...splits])
  }
  return { placed, remaining, free }
}

// ===========================================================================
// Shared helpers
// ===========================================================================

function sortPieces(pieces) {
  const vandaag = new Date().toISOString().slice(0, 10)
  return [...pieces].sort((a, b) => {
    const mA = Math.max(a.lengte_cm, a.breedte_cm)
    const mB = Math.max(b.lengte_cm, b.breedte_cm)
    if (mB !== mA) return mB - mA
    if (b.area_cm2 !== a.area_cm2) return b.area_cm2 - a.area_cm2
    const dA = a.afleverdatum ?? vandaag
    const dB = b.afleverdatum ?? vandaag
    if (dA !== dB) return dA < dB ? -1 : 1
    const nA = a.afleverdatum == null ? 1 : 0
    const nB = b.afleverdatum == null ? 1 : 0
    return nA - nB
  })
}

function pieceArea(p, vorm) {
  if (vorm === 'rond') {
    const d = Math.min(p.lengte_cm, p.breedte_cm)
    return Math.PI * (d / 2) ** 2
  }
  return p.lengte_cm * p.breedte_cm
}

function calcStats(placements, rollWidth, rollLength, vormMap) {
  if (placements.length === 0) return { gebruikte_lengte_cm: 0, afval_percentage: 0 }
  const used = Math.max(...placements.map(p => p.positie_y_cm + p.breedte_cm))
  const totalArea = placements.reduce((s, p) => s + pieceArea(p, vormMap.get(p.snijplan_id) ?? null), 0)
  const rectArea = rollWidth * used
  const afval = rectArea > 0 ? Math.round((1 - totalArea / rectArea) * 1000) / 10 : 0
  return { gebruikte_lengte_cm: used, afval_percentage: afval }
}

function computeReststukkenGuillotine(rollWidth, rollLength, plaatsingen, minShort = 50, minLong = 100) {
  const free = guil_computeFreeRects(rollWidth, rollLength, plaatsingen)
  return free.filter(r => {
    const s = Math.min(r.width, r.height)
    const l = Math.max(r.width, r.height)
    return s >= minShort && l >= minLong
  })
}

function computeReststukkenFfdh(rollWidth, rollLength, plaatsingen, minShort = 50, minLong = 100) {
  // Shelf-based reststukken (zoals in compute-reststukken.ts).
  if (plaatsingen.length === 0) {
    const r = { width: rollWidth, height: rollLength }
    const s = Math.min(r.width, r.height), l = Math.max(r.width, r.height)
    return s >= minShort && l >= minLong ? [r] : []
  }
  const byY = new Map()
  for (const p of plaatsingen) {
    const arr = byY.get(p.positie_y_cm) ?? []
    arr.push(p); byY.set(p.positie_y_cm, arr)
  }
  const shelves = []
  for (const [y, pieces] of byY) {
    pieces.sort((a, b) => a.positie_x_cm - b.positie_x_cm)
    const height = Math.max(...pieces.map(p => p.breedte_cm))
    shelves.push({ y, height, pieces })
  }
  shelves.sort((a, b) => a.y - b.y)
  const result = []
  for (const shelf of shelves) {
    const last = shelf.pieces[shelf.pieces.length - 1]
    const used = last.positie_x_cm + last.lengte_cm
    if (used < rollWidth)
      result.push({ width: rollWidth - used, height: shelf.height })
    for (const p of shelf.pieces) {
      const sliver = shelf.height - p.breedte_cm
      if (sliver > 0) result.push({ width: p.lengte_cm, height: sliver })
    }
  }
  const lastShelf = shelves[shelves.length - 1]
  const eind = lastShelf.y + lastShelf.height
  if (eind < rollLength) result.push({ width: rollWidth, height: rollLength - eind })
  return result.filter(r => {
    const s = Math.min(r.width, r.height), l = Math.max(r.width, r.height)
    return s >= minShort && l >= minLong
  })
}

// ===========================================================================
// Benchmark runner
// ===========================================================================

function scorePacking(placedCount, stats) {
  const maxPlaced = 10_000
  const notPlacedPenalty = (maxPlaced - placedCount) * 1e12
  return (
    notPlacedPenalty +
    stats.gebruikte_lengte_cm * 1e4 +
    stats.afval_percentage -
    (stats.reststuk_m2 ?? 0) * 100
  )
}

function runScenario(naam, pieces, rollen, vormMap = new Map()) {
  const sorted = sortPieces(pieces)

  const rol = rollen[0]
  const ffdhRes = ffdh_packRoll(sorted, rol.breedte_cm, rol.lengte_cm)
  const ffdhStats = calcStats(ffdhRes.placed, rol.breedte_cm, rol.lengte_cm, vormMap)
  const ffdhRest = computeReststukkenFfdh(rol.breedte_cm, rol.lengte_cm, ffdhRes.placed)

  const initFree = [{ x: 0, y: 0, width: rol.breedte_cm, height: rol.lengte_cm }]
  const guilRes = guil_packRoll(sorted, rol.breedte_cm, rol.lengte_cm, initFree)
  const guilStats = calcStats(guilRes.placed, rol.breedte_cm, rol.lengte_cm, vormMap)
  const guilRest = computeReststukkenGuillotine(rol.breedte_cm, rol.lengte_cm, guilRes.placed)

  // Reststuk-m² per algoritme uit guillotine-style freeRects
  const ffdhFreeAfter = guil_computeFreeRects(rol.breedte_cm, rol.lengte_cm, ffdhRes.placed)
  const ffdhReststukM2 = guil_reststukAreaCm2(ffdhFreeAfter) / 10000
  const guilFreeAfter = guil_computeFreeRects(rol.breedte_cm, rol.lengte_cm, guilRes.placed)
  const guilReststukM2 = guil_reststukAreaCm2(guilFreeAfter) / 10000

  // Best-of-both: kies winnaar per rol via scorePacking (incl. reststuk)
  const ffdhScore = scorePacking(ffdhRes.placed.length, { ...ffdhStats, reststuk_m2: ffdhReststukM2 })
  const guilScore = scorePacking(guilRes.placed.length, { ...guilStats, reststuk_m2: guilReststukM2 })
  const best = guilScore <= ffdhScore
    ? { placed: guilRes.placed.length, niet: guilRes.remaining.length,
        gebruikte_cm: guilStats.gebruikte_lengte_cm,
        afval_pct: guilStats.afval_percentage, reststukken: guilRest.length,
        reststuk_m2: guilReststukM2, via: 'guil' }
    : { placed: ffdhRes.placed.length, niet: ffdhRes.remaining.length,
        gebruikte_cm: ffdhStats.gebruikte_lengte_cm,
        afval_pct: ffdhStats.afval_percentage, reststukken: ffdhRest.length,
        reststuk_m2: ffdhReststukM2, via: 'ffdh' }

  return {
    naam,
    rol: `${rol.breedte_cm}×${rol.lengte_cm}`,
    stukken: pieces.length,
    ffdh: {
      geplaatst: ffdhRes.placed.length,
      niet: ffdhRes.remaining.length,
      gebruikte_cm: ffdhStats.gebruikte_lengte_cm,
      afval_pct: ffdhStats.afval_percentage,
      reststukken: ffdhRest.length,
    },
    guil: {
      geplaatst: guilRes.placed.length,
      niet: guilRes.remaining.length,
      gebruikte_cm: guilStats.gebruikte_lengte_cm,
      afval_pct: guilStats.afval_percentage,
      reststukken: guilRest.length,
    },
    best,
  }
}

function piece(id, lengte, breedte, maatwerk_vorm = null) {
  return { id, lengte_cm: lengte, breedte_cm: breedte, maatwerk_vorm,
           afleverdatum: null, area_cm2: lengte * breedte }
}

function rol(breedte, lengte) {
  return { lengte_cm: lengte, breedte_cm: breedte }
}

// ===========================================================================
// Scenario's
// ===========================================================================

const scenarios = [
  {
    naam: 'Voorbeeld 2 (IC2900VE16A) — FLOORPASSION 80×320 moet niet op nieuwe shelf',
    pieces: [piece(1, 340, 240), piece(2, 320, 80), piece(3, 240, 240, 'rond')],
    rollen: [rol(400, 1500)],
    vormMap: new Map([[3, 'rond']]),
  },
  {
    naam: 'K1756006D (FIRE 20) — 40×80 moet roteren zodat 90×180 reststuk ontstaat',
    // User-rapport: FFDH plaatst 40×80 niet-gero (genereert 50×220 + 40×140 afval).
    // Reststuk-aware: moet 80×40 gero plaatsen → 10×40 afval + 90×180 reststuk.
    pieces: [piece(1, 310, 220), piece(2, 80, 40)],
    rollen: [rol(400, 325)],
  },
  {
    naam: 'User-spec: 400×15000 rol met 2×200²+1×330×220+1×400²',
    pieces: [piece(1, 400, 400), piece(2, 330, 220), piece(3, 200, 200), piece(4, 200, 200)],
    rollen: [rol(400, 15000)],
  },
  {
    naam: 'Klein stuk past in groot reststuk (160×340) naast eerder stuk',
    // Simuleert: eerste stuk 240×340 laat 160×340 over. Tweede stuk 80×300
    // moet IN dat reststuk i.p.v. nieuwe shelf aansnijden.
    pieces: [piece(1, 340, 240), piece(2, 300, 80)],
    rollen: [rol(400, 2000)],
  },
  {
    naam: 'Many small pieces: 10× 100×100 op smalle rol',
    pieces: Array.from({ length: 10 }, (_, i) => piece(i + 1, 100, 100)),
    rollen: [rol(400, 1000)],
  },
  {
    naam: 'Mix groot+klein: 2×(400×400) + 4×(100×100)',
    pieces: [
      piece(1, 400, 400), piece(2, 400, 400),
      piece(3, 100, 100), piece(4, 100, 100), piece(5, 100, 100), piece(6, 100, 100),
    ],
    rollen: [rol(400, 2000)],
  },
  {
    naam: 'Rotatie-test: 3×(450×200) moet roteren naar 200×450',
    pieces: [piece(1, 450, 200), piece(2, 450, 200), piece(3, 450, 200)],
    rollen: [rol(400, 2000)],
  },
  {
    naam: 'Lange smalle rol: 2×(300×100) + 1×(150×100) op 320×500',
    pieces: [piece(1, 300, 100), piece(2, 300, 100), piece(3, 150, 100)],
    rollen: [rol(320, 500)],
  },
  {
    naam: 'IC2901TA13B scenario — rol 400×250: dead-zone test (rol-rest <100cm)',
    // Screenshot 1: 243×200 + 45×170 + 80×163 op 400×250 rol.
    // Huidige FFDH: shelf y=0 hoog 200 → yEnd=200, rol-rest 50cm (dead zone).
    //   End-strip 400×50 + sliver-afval. ~2.0 m² "reststuk" maar onbruikbaar
    //   als aangebroken-rol (50<100).
    // Dead-zone-aware Guillotine: zou 243×200 geroteerd (200×243) moeten
    //   kiezen zodat yEnd=243, rol-rest 7cm (ook dead), maar met 75×243
    //   reststuk aan de zijkant — hogere reststuk-m² binnen dead-zone.
    pieces: [piece(1, 243, 200), piece(2, 45, 170), piece(3, 80, 163)],
    rollen: [rol(400, 250)],
  },
  {
    naam: 'Stress: 20 random stukken 50-300cm',
    pieces: (() => {
      // Deterministische pseudo-random: seed 42
      let s = 42
      const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff, s / 0x7fffffff)
      return Array.from({ length: 20 }, (_, i) => {
        const l = 50 + Math.floor(rand() * 250)
        const b = 50 + Math.floor(rand() * 250)
        return piece(i + 1, l, b)
      })
    })(),
    rollen: [rol(400, 3000)],
  },
]

// ===========================================================================
// Run & print results
// ===========================================================================

console.log('\nFFDH vs Guillotine — Snijplan Algoritme-Vergelijking')
console.log('='.repeat(90))

const resultaten = scenarios.map(s => runScenario(s.naam, s.pieces, s.rollen, s.vormMap))

for (const r of resultaten) {
  console.log(`\n${r.naam}`)
  console.log(`  rol: ${r.rol}, stukken: ${r.stukken}`)
  const ffdhReststukM2 = guil_reststukAreaCm2(guil_computeFreeRects(
    scenarios[resultaten.indexOf(r)].rollen[0].breedte_cm,
    scenarios[resultaten.indexOf(r)].rollen[0].lengte_cm,
    [] // placeholder; reststuk gecached via best output
  )) / 10000
  console.log(`  FFDH       → geplaatst: ${r.ffdh.geplaatst}/${r.stukken}, gebruikt: ${r.ffdh.gebruikte_cm} cm, afval: ${r.ffdh.afval_pct}%, reststukken: ${r.ffdh.reststukken}`)
  console.log(`  Guillotine → geplaatst: ${r.guil.geplaatst}/${r.stukken}, gebruikt: ${r.guil.gebruikte_cm} cm, afval: ${r.guil.afval_pct}%, reststukken: ${r.guil.reststukken}`)
  console.log(`  BEST-OF-BOTH (via ${r.best.via})  → gebruikt: ${r.best.gebruikte_cm} cm, afval: ${r.best.afval_pct}%, reststuk: ${r.best.reststuk_m2.toFixed(2)} m²`)
  const deltaCm = r.ffdh.gebruikte_cm - r.best.gebruikte_cm
  const m2Saved = deltaCm * scenarios[resultaten.indexOf(r)].rollen[0].breedte_cm / 10000
  const deltaReststukken = r.best.reststukken - r.ffdh.reststukken
  let marker
  if (deltaCm > 0) marker = 'WINST (rol-lengte)'
  else if (deltaCm < 0) marker = 'REGRESSIE'
  else if (deltaReststukken > 0) marker = `WINST (+${deltaReststukken} reststuk${deltaReststukken === 1 ? '' : 'ken'})`
  else marker = 'gelijk'
  console.log(`  Δ vs FFDH: ${deltaCm >= 0 ? '+' : ''}${deltaCm} cm  (${m2Saved.toFixed(2)} m²)  →  ${marker}`)
}

// Samenvatting
const samenvattend = resultaten.reduce((acc, r) => {
  const d = r.ffdh.gebruikte_cm - r.best.gebruikte_cm
  const extraReststuk = r.best.reststukken - r.ffdh.reststukken
  if (d > 0) acc.winstRolLengte++
  else if (d < 0) acc.regressie++
  else if (extraReststuk > 0) acc.winstReststuk++
  else acc.gelijk++
  acc.totaalCmBesparing += d
  acc.totaalExtraReststukken += Math.max(0, extraReststuk)
  if (r.best.via === 'guil') acc.viaGuil++
  else acc.viaFfdh++
  return acc
}, { winstRolLengte: 0, winstReststuk: 0, regressie: 0, gelijk: 0, totaalCmBesparing: 0, totaalExtraReststukken: 0, viaGuil: 0, viaFfdh: 0 })

console.log('\n' + '='.repeat(90))
console.log('SAMENVATTING (best-of-both t.o.v. huidige FFDH)')
console.log(`  Winst op rol-lengte: ${samenvattend.winstRolLengte}/${resultaten.length}`)
console.log(`  Winst alleen op reststuk-m²: ${samenvattend.winstReststuk}/${resultaten.length}`)
console.log(`  Regressie:  ${samenvattend.regressie}/${resultaten.length}  ${samenvattend.regressie === 0 ? 'GEEN REGRESSIES' : 'LET OP'}`)
console.log(`  Gelijk:     ${samenvattend.gelijk}/${resultaten.length}`)
console.log(`  Via Guillotine: ${samenvattend.viaGuil} scenarios`)
console.log(`  Via FFDH:       ${samenvattend.viaFfdh} scenarios`)
console.log(`  Totaal rol-lengte bespaard: ${samenvattend.totaalCmBesparing} cm`)
console.log(`  Totaal extra reststukken behouden: ${samenvattend.totaalExtraReststukken}`)
console.log()
