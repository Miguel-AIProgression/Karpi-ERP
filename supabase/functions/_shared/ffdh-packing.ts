// Shared FFDH (First Fit Decreasing Height) 2D strip-packing algorithm
// Used by: optimaliseer-snijplan, auto-plan-groep

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnijplanPiece {
  id: number
  lengte_cm: number
  breedte_cm: number
  maatwerk_vorm: string | null
  order_nr: string | null
  klant_naam: string | null
  afleverdatum: string | null
  area_cm2: number
}

export interface Roll {
  id: number
  rolnummer: string
  lengte_cm: number
  breedte_cm: number
  status: string
  oppervlak_m2: number
  sort_priority: number // 1=reststuk, 2=beschikbaar
  is_exact: boolean     // true = exact kwaliteit match, false = uitwisselbaar
}

export interface Shelf {
  y: number         // Y position (top of shelf)
  height: number    // tallest piece on this shelf
  usedWidth: number // how much X is consumed
  maxWidth: number  // = roll width
}

export interface Placement {
  snijplan_id: number
  positie_x_cm: number
  positie_y_cm: number
  lengte_cm: number   // placed width dimension (along X)
  breedte_cm: number  // placed height dimension (along Y)
  geroteerd: boolean
}

export interface RollResult {
  rol_id: number
  rolnummer: string
  rol_lengte_cm: number
  rol_breedte_cm: number
  rol_status: string
  plaatsingen: Placement[]
  gebruikte_lengte_cm: number
  afval_percentage: number
  restlengte_cm: number
}

export interface UnplacedPiece {
  snijplan_id: number
  reden: string
}

// ---------------------------------------------------------------------------
// FFDH strip-packing algorithm
// ---------------------------------------------------------------------------

/**
 * Check of minstens één toekomstig stuk (in enige orientatie) past in een gat
 * van `gapWidth` breed en `shelfHeight` hoog.
 */
export function gapIsUseful(
  gapWidth: number,
  shelfHeight: number,
  futurePieces: SnijplanPiece[],
): boolean {
  return futurePieces.some(p =>
    (p.lengte_cm <= gapWidth && p.breedte_cm <= shelfHeight) ||
    (p.breedte_cm <= gapWidth && p.lengte_cm <= shelfHeight)
  )
}

/**
 * Try to place a single piece on a roll using FFDH with lookahead scoring.
 *
 * Axes:
 *   X = across roll width (breedte)
 *   Y = along roll length (lengte)
 *
 * Scoring tiers (lower = better):
 *   0: Perfect fit (remaining width = 0)
 *   1: Existing shelf, gap fillable by future piece
 *   2: New shelf, gap fillable by future piece
 *   3: Existing shelf, unusable gap
 *   4: New shelf, unusable gap
 * Tiebreakers: least height waste, then least width waste.
 */
export function tryPlacePiece(
  piece: SnijplanPiece,
  shelves: Shelf[],
  rollWidth: number,
  rollLength: number,
  futurePieces: SnijplanPiece[],
): Placement | null {
  // Two orientations to try
  const orientations: Array<{
    w: number   // width along X
    h: number   // height along Y
    rotated: boolean
  }> = [
    { w: piece.lengte_cm, h: piece.breedte_cm, rotated: false },
    { w: piece.breedte_cm, h: piece.lengte_cm, rotated: true },
  ]

  let bestPlacement: Placement | null = null
  let bestTier = Infinity
  let bestHeightWaste = Infinity
  let bestWidthWaste = Infinity

  for (const orient of orientations) {
    // Skip if piece wider than roll
    if (orient.w > rollWidth) continue

    // 1. Try existing shelves
    for (const shelf of shelves) {
      if (orient.h <= shelf.height && shelf.usedWidth + orient.w <= shelf.maxWidth) {
        const remaining = shelf.maxWidth - shelf.usedWidth - orient.w
        const heightWaste = shelf.height - orient.h
        const tier = remaining === 0 ? 0
          : gapIsUseful(remaining, shelf.height, futurePieces) ? 1
          : 3

        if (
          tier < bestTier ||
          (tier === bestTier && heightWaste < bestHeightWaste) ||
          (tier === bestTier && heightWaste === bestHeightWaste && remaining < bestWidthWaste)
        ) {
          bestTier = tier
          bestHeightWaste = heightWaste
          bestWidthWaste = remaining
          bestPlacement = {
            snijplan_id: piece.id,
            positie_x_cm: shelf.usedWidth,
            positie_y_cm: shelf.y,
            lengte_cm: orient.w,
            breedte_cm: orient.h,
            geroteerd: orient.rotated,
          }
        }
      }
    }

    // 2. Try creating a new shelf
    const totalShelfHeight = shelves.reduce(
      (sum, s) => Math.max(sum, s.y + s.height),
      0,
    )
    if (totalShelfHeight + orient.h <= rollLength && orient.w <= rollWidth) {
      const remaining = rollWidth - orient.w
      const heightWaste = 0 // new shelf matches piece height exactly
      const tier = remaining === 0 ? 0
        : gapIsUseful(remaining, orient.h, futurePieces) ? 2
        : 4

      if (
        tier < bestTier ||
        (tier === bestTier && heightWaste < bestHeightWaste) ||
        (tier === bestTier && heightWaste === bestHeightWaste && remaining < bestWidthWaste)
      ) {
        bestTier = tier
        bestHeightWaste = heightWaste
        bestWidthWaste = remaining
        bestPlacement = {
          snijplan_id: piece.id,
          positie_x_cm: 0,
          positie_y_cm: totalShelfHeight,
          lengte_cm: orient.w,
          breedte_cm: orient.h,
          geroteerd: orient.rotated,
        }
      }
    }
  }

  return bestPlacement
}

/**
 * Run FFDH packing for a list of pieces onto a single roll.
 * Returns placed pieces and remaining unplaced pieces.
 */
export function packRoll(
  pieces: SnijplanPiece[],
  rollWidth: number,
  rollLength: number,
): { placed: Placement[]; remaining: SnijplanPiece[] } {
  const shelves: Shelf[] = []
  const placed: Placement[] = []
  const remaining: SnijplanPiece[] = []
  const placedIds = new Set<number>()

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]
    // Lookahead: alleen toekomstige, nog niet geplaatste stukken
    const futurePieces = pieces.slice(i + 1).filter(p => !placedIds.has(p.id))
    const placement = tryPlacePiece(piece, shelves, rollWidth, rollLength, futurePieces)

    if (placement) {
      placed.push(placement)
      placedIds.add(piece.id)

      // Update or create shelf
      const existingShelf = shelves.find(
        (s) => s.y === placement.positie_y_cm,
      )
      if (existingShelf) {
        existingShelf.usedWidth += placement.lengte_cm
      } else {
        shelves.push({
          y: placement.positie_y_cm,
          height: placement.breedte_cm,
          usedWidth: placement.lengte_cm,
          maxWidth: rollWidth,
        })
      }
    } else {
      remaining.push(piece)
    }
  }

  return { placed, remaining }
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

/** Calculate actual area of a piece (accounting for round shapes). */
export function pieceArea(p: Placement, vorm: string | null): number {
  if (vorm === 'rond') {
    const diameter = Math.min(p.lengte_cm, p.breedte_cm)
    return Math.PI * (diameter / 2) ** 2
  }
  return p.lengte_cm * p.breedte_cm
}

export function calcRollStats(
  placements: Placement[],
  rollWidth: number,
  rollLength: number,
  pieceVormMap: Map<number, string | null>,
): { gebruikte_lengte_cm: number; afval_percentage: number; restlengte_cm: number } {
  if (placements.length === 0) {
    return { gebruikte_lengte_cm: 0, afval_percentage: 0, restlengte_cm: rollLength }
  }

  const gebruikte_lengte_cm = Math.max(
    ...placements.map((p) => p.positie_y_cm + p.breedte_cm),
  )

  const totalPieceArea = placements.reduce(
    (sum, p) => sum + pieceArea(p, pieceVormMap.get(p.snijplan_id) ?? null),
    0,
  )

  const usedRectArea = rollWidth * gebruikte_lengte_cm
  const afval_percentage =
    usedRectArea > 0
      ? Math.round((1 - totalPieceArea / usedRectArea) * 1000) / 10
      : 0

  const restlengte_cm = rollLength - gebruikte_lengte_cm

  return { gebruikte_lengte_cm, afval_percentage, restlengte_cm }
}

// ---------------------------------------------------------------------------
// Sorting helpers
// ---------------------------------------------------------------------------

/**
 * Sort pieces: earliest delivery date first, then by max dimension (widest first), then by area.
 * Pieces without a delivery date are sorted last (lowest priority).
 * This ensures urgent orders are placed first while still packing efficiently.
 */
export function sortPieces(pieces: SnijplanPiece[]): SnijplanPiece[] {
  return [...pieces].sort((a, b) => {
    // 1. Earliest delivery date first (null = last)
    const dateA = a.afleverdatum ?? '9999-12-31'
    const dateB = b.afleverdatum ?? '9999-12-31'
    if (dateA !== dateB) return dateA < dateB ? -1 : 1

    // 2. Widest first (better packing within same urgency)
    const maxA = Math.max(a.lengte_cm, a.breedte_cm)
    const maxB = Math.max(b.lengte_cm, b.breedte_cm)
    if (maxB !== maxA) return maxB - maxA

    // 3. Largest area first
    return b.area_cm2 - a.area_cm2
  })
}

/** Sort rolls: exact kwaliteit first, then reststuk before beschikbaar, smallest area first */
export function sortRolls(rollen: Roll[]): Roll[] {
  return [...rollen].sort((a, b) => {
    if (a.is_exact !== b.is_exact) return a.is_exact ? -1 : 1
    if (a.sort_priority !== b.sort_priority) return a.sort_priority - b.sort_priority
    return a.lengte_cm * a.breedte_cm - b.lengte_cm * b.breedte_cm
  })
}

// ---------------------------------------------------------------------------
// Multi-roll packing orchestration
// ---------------------------------------------------------------------------

export interface PackingSummary {
  totaal_stukken: number
  geplaatst: number
  niet_geplaatst: number
  totaal_rollen: number
  gemiddeld_afval_pct: number
  totaal_m2_gebruikt: number
  totaal_m2_afval: number
}

export interface PackingResult {
  rollResults: RollResult[]
  nietGeplaatst: UnplacedPiece[]
  samenvatting: PackingSummary
}

/**
 * Pack pieces across multiple rolls using FFDH algorithm.
 * Returns complete packing result with statistics.
 */
export function packAcrossRolls(
  pieces: SnijplanPiece[],
  rolls: Roll[],
  pieceVormMap: Map<number, string | null>,
): PackingResult {
  const sortedPieces = sortPieces(pieces)
  const sortedRolls = sortRolls(rolls)

  let unplacedPieces = [...sortedPieces]
  const rollResults: RollResult[] = []

  for (const roll of sortedRolls) {
    if (unplacedPieces.length === 0) break

    const { placed, remaining } = packRoll(
      unplacedPieces,
      roll.breedte_cm, // X axis = roll width
      roll.lengte_cm,  // Y axis = roll length
    )

    if (placed.length > 0) {
      const stats = calcRollStats(placed, roll.breedte_cm, roll.lengte_cm, pieceVormMap)
      rollResults.push({
        rol_id: roll.id,
        rolnummer: roll.rolnummer,
        rol_lengte_cm: roll.lengte_cm,
        rol_breedte_cm: roll.breedte_cm,
        rol_status: roll.status,
        plaatsingen: placed,
        ...stats,
      })
    }

    unplacedPieces = remaining
  }

  const nietGeplaatst: UnplacedPiece[] = unplacedPieces.map((p) => ({
    snijplan_id: p.id,
    reden: 'Geen rol met voldoende ruimte',
  }))

  // Calculate summary
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
