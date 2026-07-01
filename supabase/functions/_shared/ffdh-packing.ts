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
  /** Mig 450 (Fase 2): handmatige vlag, krijgt hoogste prioriteit in sortPieces. */
  express: boolean
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
  has_existing_placements?: boolean // true als rol al Snijden-stukken heeft (nog niet in productie)
  /** ISO-datum (YYYY-MM-DD) waarop dit materiaal het magazijn binnenkwam.
   *  Erft door reststukken van de moederrol (mig 280-282, ADR-0021).
   *  NULL = onbekend → packer behandelt als "heel oud" (FIFO-voorrang). */
  in_magazijn_sinds?: string | null
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

  // Naast-elkaar-tiebreaker: als een toekomstig stuk van DEZELFDE afmetingen in het
  // restgat past, geef die oriëntatie voorrang boven de kleinere-restbreedte-voorkeur.
  // Zo worden twee 160×230 stuks op een 400cm rol NAAST ELKAAR geplaatst (2×160=320≤400)
  // i.p.v. apart (elk 230cm breed op een eigen shelf). Alleen actief als er echt een
  // volgend stuk van dezelfde maat bestaat (voorkomen dat we onnodig ruimte reserveren).
  const heeftZelfdeSoort = futurePieces.some(p =>
    (Math.abs(p.lengte_cm - piece.lengte_cm) < 0.1 && Math.abs(p.breedte_cm - piece.breedte_cm) < 0.1) ||
    (Math.abs(p.lengte_cm - piece.breedte_cm) < 0.1 && Math.abs(p.breedte_cm - piece.lengte_cm) < 0.1)
  )
  const naastElkaarMogelijk = (gapW: number, gapH: number): boolean => {
    if (!heeftZelfdeSoort) return false
    return (piece.lengte_cm <= gapW && piece.breedte_cm <= gapH) ||
           (piece.breedte_cm <= gapW && piece.lengte_cm <= gapH)
  }

  let bestPlacement: Placement | null = null
  let bestTier = Infinity
  let bestHeightWaste = Infinity
  let bestWidthWaste = Infinity
  let bestNaastElkaar = false

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
        const currentNaastElkaar = remaining > 0 && naastElkaarMogelijk(remaining, shelf.height)

        if (
          tier < bestTier ||
          (tier === bestTier && heightWaste < bestHeightWaste) ||
          (tier === bestTier && heightWaste === bestHeightWaste && currentNaastElkaar && !bestNaastElkaar) ||
          (tier === bestTier && heightWaste === bestHeightWaste && currentNaastElkaar === bestNaastElkaar && remaining < bestWidthWaste)
        ) {
          bestTier = tier
          bestHeightWaste = heightWaste
          bestWidthWaste = remaining
          bestNaastElkaar = currentNaastElkaar
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
      const currentNaastElkaar = remaining > 0 && naastElkaarMogelijk(remaining, orient.h)

      if (
        tier < bestTier ||
        (tier === bestTier && heightWaste < bestHeightWaste) ||
        (tier === bestTier && heightWaste === bestHeightWaste && currentNaastElkaar && !bestNaastElkaar) ||
        (tier === bestTier && heightWaste === bestHeightWaste && currentNaastElkaar === bestNaastElkaar && remaining < bestWidthWaste)
      ) {
        bestTier = tier
        bestHeightWaste = heightWaste
        bestWidthWaste = remaining
        bestNaastElkaar = currentNaastElkaar
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
 * Reconstrueer shelves uit bestaande plaatsingen op een rol.
 * Plaatsingen met dezelfde positie_y_cm liggen op dezelfde shelf.
 * Gebruikt voor rollen die al gedeeltelijk gepland zijn (status in_snijplan,
 * nog niet in productie) — zodat nieuwe stukken in bestaande shelf-gaps
 * geplaatst kunnen worden i.p.v. een nieuwe rol aan te snijden.
 */
export function reconstructShelves(
  placements: Placement[],
  rollWidth: number,
): Shelf[] {
  if (placements.length === 0) return []

  const byY = new Map<number, Placement[]>()
  for (const p of placements) {
    const arr = byY.get(p.positie_y_cm) ?? []
    arr.push(p)
    byY.set(p.positie_y_cm, arr)
  }

  const shelves: Shelf[] = []
  for (const [y, group] of byY) {
    const height = Math.max(...group.map((p) => p.breedte_cm))
    const usedWidth = group.reduce(
      (sum, p) => Math.max(sum, p.positie_x_cm + p.lengte_cm),
      0,
    )
    shelves.push({ y, height, usedWidth, maxWidth: rollWidth })
  }
  return shelves
}

/**
 * Run FFDH packing for a list of pieces onto a single roll.
 * Returns placed pieces and remaining unplaced pieces.
 *
 * `initialShelves` bevat bestaande plaatsingen (uit eerder snijvoorstel).
 * Nieuwe stukken kunnen bestaande shelf-gaps opvullen voor optimaal
 * materiaalgebruik.
 */
export function packRoll(
  pieces: SnijplanPiece[],
  rollWidth: number,
  rollLength: number,
  initialShelves: Shelf[] = [],
): { placed: Placement[]; remaining: SnijplanPiece[] } {
  const shelves: Shelf[] = initialShelves.map((s) => ({ ...s }))
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
 * Sort pieces voor klassieke FFDH: hoogste dimensie eerst (Decreasing Height),
 * dan grootste oppervlak, dan afleverdatum als tie-breaker.
 *
 * Volgorde-keuze: strip-packing literatuur toont dat grootste-eerst de
 * beste materiaalbenutting geeft. Als we afleverdatum primair zouden
 * sorteren, kan een klein-urgent stuk een nieuwe shelf afdwingen terwijl
 * een groter-later stuk daarna een passend gap-vrije shelf creëert waar
 * het kleine stuk in had gepast. Praktijkvoorbeeld (OASI 11): 100×100 vóór
 * 170×170 gaf 3 shelves; 170×170 vóór 100×100 geeft 2 shelves met 100×100
 * in het 150×170-gap naast de 170×170. Afleverdatum speelt nog mee als
 * tie-breaker én via de horizon-filter (p_tot_datum) in de auto-plan flow.
 *
 * NULL-afleverdatum (maatwerk zonder afgesproken deadline): behandelen we
 * als 'vandaag' — wens is zsm leveren, dus sorteren alsof de deadline nu
 * is. Tie-break daaronder geeft echte deadlines voorrang bij gelijke
 * datum, zodat een NULL-stuk nooit een afspraak verdringt.
 */
export function sortPieces(pieces: SnijplanPiece[]): SnijplanPiece[] {
  const vandaag = new Date().toISOString().slice(0, 10)
  return [...pieces].sort((a, b) => {
    // 0. Express altijd eerst (Fase 2, mig 450) — vóór grootte/oppervlak/
    // afleverdatum, ongeacht stukafmeting. Dit is precies het mechanisme dat
    // een express-stuk een plek op een rol laat "verdringen" t.o.v. een
    // niet-express-stuk dat verder identiek scoort; auto-plan-groep detecteert
    // en bewaakt die verdringing (zie de "geen regressie"-check daar).
    if (a.express !== b.express) return a.express ? -1 : 1

    // 1. Grootste dimensie eerst (FFDH-standaard).
    const maxA = Math.max(a.lengte_cm, a.breedte_cm)
    const maxB = Math.max(b.lengte_cm, b.breedte_cm)
    if (maxB !== maxA) return maxB - maxA

    // 2. Grootste oppervlak eerst (bij gelijke hoogte).
    if (b.area_cm2 !== a.area_cm2) return b.area_cm2 - a.area_cm2

    // 3. Effectieve deadline: NULL = vandaag (ASAP).
    const dateA = a.afleverdatum ?? vandaag
    const dateB = b.afleverdatum ?? vandaag
    if (dateA !== dateB) return dateA < dateB ? -1 : 1

    // 4. Bij gelijke datum: echte deadline vóór NULL (geen deadline verdringen).
    const nullA = a.afleverdatum == null ? 1 : 0
    const nullB = b.afleverdatum == null ? 1 : 0
    return nullA - nullB
  })
}

/** Sort rolls: exact kwaliteit first, then rollen-met-bestaande-plaatsingen
 * (gap-filling boven nieuwe rol aansnijden), dan reststuk voor beschikbaar,
 * dan kleinste oppervlak eerst. */
export function sortRolls(rollen: Roll[]): Roll[] {
  return [...rollen].sort((a, b) => {
    if (a.is_exact !== b.is_exact) return a.is_exact ? -1 : 1
    const aExisting = a.has_existing_placements ? 1 : 0
    const bExisting = b.has_existing_placements ? 1 : 0
    if (aExisting !== bExisting) return bExisting - aExisting
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

/**
 * FIFO-magazijnleeftijd-parameters (ADR-0021). Bron: app_config.snijplanning.
 * Alle drempels online tunebaar zonder code-deploy.
 */
export interface FifoOptions {
  /** Bedrijfsmodus (ADR-0021).
   *  - 'simpel' (default, huidige live-gedrag): strikt FIFO — altijd de
   *    oudst-binnengekomen rol eerst, géén kost-afweging, géén badge, géén
   *    auto-approve-carve-out. De geavanceerde laag blijft in code aanwezig
   *    maar inactief tot de interne data op orde is.
   *  - 'geavanceerd': volledige leeftijd-vs-snijverlies-kostfunctie + badge
   *    + rode-badge-carve-out. */
  modus: 'simpel' | 'geavanceerd'
  /** Leeftijd telt pas mee bóven deze grens (dagen). */
  drempelDagen: number
  /** Daarboven absolute snij-voorrang binnen C1/C2 (dagen). */
  hardeBovengrensDagen: number
  /** m²-afval-equivalent per dag bóven de drempel. */
  alpha: number
  /** Vandaag als ISO-datum (YYYY-MM-DD) — expliciet voor testbaarheid. */
  vandaag: string
  /** Badge-drempels (extra afval t.o.v. de pure-efficiency-variant). */
  badgeGeelM2: number
  badgeGeelPct: number
  badgeRoodM2: number
  badgeRoodPct: number
  /** C1 — rol-ids die al gereserveerd zijn voor een ander snijvoorstel.
   *  De FIFO-voorkeur mag zo'n rol niet als nieuwe aansnijding naar voren
   *  halen (geen verdringing). */
  gereserveerdeRolIds?: Set<number>
}

/** Uitkomst van de leeftijd-vs-efficiency-vergelijking (ADR-0021). */
export interface FifoMetrics {
  badge: 'grijs' | 'geel' | 'rood'
  extra_afval_m2: number
  extra_afval_pct: number
  oudste_rol_dagen: number
  efficient_oudste_rol_dagen: number
  rolwissels: number
  efficient_rolwissels: number
  rationale: Array<{
    rol_id: number
    rolnummer: string
    leeftijd_dagen: number
  }>
  reden: string
}

export interface PackingResult {
  rollResults: RollResult[]
  nietGeplaatst: UnplacedPiece[]
  samenvatting: PackingSummary
  /** Alleen gevuld als PackOptions.fifo is meegegeven (ADR-0021). */
  fifoMetrics?: FifoMetrics
}

export interface PackOptions {
  /** Bestaande Snijden-plaatsingen per rol_id, voor shelf-reconstructie. */
  bezetteMap?: Map<number, Placement[]>
  /** Max toegestane verspilling (%) om een reststuk-rol aan te snijden.
   *  Als afval > max_pct na packing, wordt de reststuk-rol verworpen
   *  (stukken gaan terug in de pool voor een andere rol). */
  maxReststukVerspillingPct?: number
  /** FIFO-magazijnleeftijd-afweging (ADR-0021). Afwezig = legacy-gedrag
   *  ongewijzigd (leeftijd speelt niet mee). */
  fifo?: FifoOptions
}

/**
 * Pack pieces across multiple rolls using FFDH algorithm.
 * Returns complete packing result with statistics.
 *
 * - `options.bezetteMap`: nieuwe stukken landen in bestaande shelf-gaps van
 *   reeds-deels-geplande rollen (status in_snijplan, niet in productie).
 *   Bestaande plaatsingen komen NIET opnieuw in het resultaat.
 * - `options.maxReststukVerspillingPct`: reststukken worden alleen gebruikt
 *   als hun afval_percentage ≤ max_pct blijft. Anders verworpen om het
 *   reststuk intact te bewaren.
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
    const initialShelves = reconstructShelves(bezettePlaatsingen, roll.breedte_cm)

    const { placed, remaining } = packRoll(
      unplacedPieces,
      roll.breedte_cm, // X axis = roll width
      roll.lengte_cm,  // Y axis = roll length
      initialShelves,
    )

    if (placed.length === 0) continue

    // Statistieken bevatten zowel nieuwe als bestaande plaatsingen, zodat
    // afval_percentage klopt t.o.v. de daadwerkelijk gebruikte rol-lengte.
    const allPlacements = [...bezettePlaatsingen, ...placed]
    const stats = calcRollStats(allPlacements, roll.breedte_cm, roll.lengte_cm, pieceVormMap)

    // Reststuk-bescherming: als afval boven max_pct uitkomt, verwerpen —
    // unplacedPieces blijft onveranderd zodat de stukken op een andere rol
    // kunnen landen.
    if (
      roll.status === 'reststuk' &&
      maxReststukVerspillingPct !== undefined &&
      stats.afval_percentage > maxReststukVerspillingPct
    ) {
      continue
    }

    rollResults.push({
      rol_id: roll.id,
      rolnummer: roll.rolnummer,
      rol_lengte_cm: roll.lengte_cm,
      rol_breedte_cm: roll.breedte_cm,
      rol_status: roll.status,
      plaatsingen: placed,
      ...stats,
    })
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
