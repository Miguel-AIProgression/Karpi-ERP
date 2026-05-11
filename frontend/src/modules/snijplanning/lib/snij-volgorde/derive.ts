// Pure transformer: SnijplanRow[] + reststuk/afval/aangebroken → SnijVolgorde.
//
// Mental-model: een SnijVolgorde is wat de operator letterlijk uitvoert. Elke
// `Rij` is één breedte-mes-instelling. Pieces met dezelfde Y-overlap zitten in
// dezelfde Rij (multi-lane); pieces gestapeld langs Y vormen aparte Rijen.
// Consecutive Rijen met dezelfde primary breedte-mes-positie krijgen
// `is_breedte_mes_overgenomen=true` ("Mes laten staan op X").
//
// Coordinate-conventie: X = over rolbreedte, Y = langs rollengte. Piece
// "lengte_cm" = X-extent, "breedte_cm" = Y-extent (bestaande codebase-conventie,
// in de packer + snijplannen-schema).

import type { ReststukRect } from '@/lib/types/productie'
import type {
  AangebrokenMarker,
  AfvalRect,
  HandelingInstructie,
  KnifeOperation,
  ReststukMarker,
  Rij,
  SnijVolgorde,
} from './types'

// Minimaal contract van een placement-rij dat de transformer nodig heeft.
// Aparte interface zodat tests fixtures kunnen leveren zonder de volledige
// SnijplanRow-shape (15+ velden) te moeten reproduceren.
export interface PlacementInput {
  id: number
  snijplan_nr: string
  positie_x_cm: number
  positie_y_cm: number
  // snij_lengte_cm/snij_breedte_cm = bestelde maat in originele orientatie
  // (zoals opgeslagen in snijplannen.lengte_cm/breedte_cm).
  snij_lengte_cm: number    // X-extent in originele orientatie
  snij_breedte_cm: number   // Y-extent in originele orientatie
  geroteerd: boolean | null
  marge_cm: number          // uit migratie 143 view-kolom
  maatwerk_vorm: string | null
  maatwerk_afwerking: string | null
  // Sticker info
  order_id: number
  order_nr: string
  klant_naam: string
  artikelnr: string | null
  afleverdatum: string | null
}

export interface BuildSnijVolgordeInput {
  rolnummer: string
  rol_breedte_cm: number
  rol_lengte_cm: number
  placements: PlacementInput[]
  reststukken: ReststukRect[]
  aangebrokenEnd: { y_cm: number; breedte_cm: number; lengte_cm: number } | null
  afval: ReststukRect[]
}

// ---------------------------------------------------------------------------
// 1. Placement → augmented (placed dimensions + bestelde maat + handeling).
// ---------------------------------------------------------------------------

interface AugmentedPlacement extends PlacementInput {
  // Werkelijke X/Y-extent van het geplaatste stuk op de rol (met marge,
  // rotatie toegepast). Dit is wat de mes moet snijden.
  placed_x_cm: number
  placed_y_cm: number
  // Bestelde maat in klant-orientatie (sticker, hand-finishing target).
  bestelde_x_cm: number
  bestelde_y_cm: number
}

function augmentPlacement(p: PlacementInput): AugmentedPlacement {
  const isRotated = p.geroteerd === true
  // snijplannen.lengte_cm/breedte_cm staan in originele orientatie; bij
  // geroteerd worden X en Y omgewisseld voor de fysieke plaatsing.
  const placed_x_unrotated = isRotated ? p.snij_breedte_cm : p.snij_lengte_cm
  const placed_y_unrotated = isRotated ? p.snij_lengte_cm : p.snij_breedte_cm
  return {
    ...p,
    placed_x_cm: placed_x_unrotated + p.marge_cm,
    placed_y_cm: placed_y_unrotated + p.marge_cm,
    // Bestelde blijft in originele orientatie (klant-perspectief).
    bestelde_x_cm: p.snij_lengte_cm,
    bestelde_y_cm: p.snij_breedte_cm,
  }
}

function deriveHandeling(p: AugmentedPlacement): HandelingInstructie {
  const vorm = (p.maatwerk_vorm ?? '').toLowerCase()
  if (vorm === 'rond') return { kind: 'rond_uitsnijden' }
  if (vorm === 'ovaal') return { kind: 'ovaal_uitsnijden' }
  if (p.geroteerd === true) return { kind: 'orientatie_swap' }
  if (p.maatwerk_afwerking === 'ZO' && p.marge_cm > 0) {
    return { kind: 'zo_marge_extra', marge_cm: p.marge_cm }
  }
  return { kind: 'geen' }
}

function toKnifeOperation(p: AugmentedPlacement): KnifeOperation {
  return {
    snijplan_id: p.id,
    snijplan_nr: p.snijplan_nr,
    x_start_cm: p.positie_x_cm,
    snij_maat_x_cm: Math.round(p.placed_x_cm),
    snij_maat_y_cm: Math.round(p.placed_y_cm),
    bestelde_x_cm: Math.round(p.bestelde_x_cm),
    bestelde_y_cm: Math.round(p.bestelde_y_cm),
    bestelde_vorm: (p.maatwerk_vorm ?? 'rechthoek') as KnifeOperation['bestelde_vorm'],
    bestelde_afwerking: p.maatwerk_afwerking as KnifeOperation['bestelde_afwerking'],
    marge_cm: p.marge_cm,
    handeling: deriveHandeling(p),
    order_id: p.order_id,
    order_nr: p.order_nr,
    klant_naam: p.klant_naam,
    artikelnr: p.artikelnr,
    afleverdatum: p.afleverdatum,
  }
}

// ---------------------------------------------------------------------------
// 2. Shelf-clustering: pieces met overlappende Y-range delen een Rij.
// ---------------------------------------------------------------------------

interface ShelfRaw {
  y_start_cm: number
  y_end_cm: number
  pieces: AugmentedPlacement[]
}

const Y_OVERLAP_EPSILON = 1   // cm — touching ≠ overlap

function clusterShelves(placements: AugmentedPlacement[]): ShelfRaw[] {
  const sorted = [...placements].sort((a, b) => {
    if (a.positie_y_cm !== b.positie_y_cm) return a.positie_y_cm - b.positie_y_cm
    return a.positie_x_cm - b.positie_x_cm
  })

  const shelves: ShelfRaw[] = []
  for (const p of sorted) {
    const y_start_cm = p.positie_y_cm
    const y_end_cm = p.positie_y_cm + p.placed_y_cm
    const last = shelves[shelves.length - 1]
    // Overlap = strict less than current shelf's y_end (touching counts as separate).
    if (last && y_start_cm < last.y_end_cm - Y_OVERLAP_EPSILON) {
      last.pieces.push(p)
      if (y_end_cm > last.y_end_cm) last.y_end_cm = y_end_cm
    } else {
      shelves.push({ y_start_cm, y_end_cm, pieces: [p] })
    }
  }
  return shelves
}

// ---------------------------------------------------------------------------
// 3. Rij-bouw: shelf → Rij met breedte-messen, lengte-mes, knife operations.
// ---------------------------------------------------------------------------

const MAX_BREEDTE_MESSEN = 3

function buildRij(
  shelf: ShelfRaw,
  rij_nummer: number,
  prev_primary_mes_cm: number | null,
): Rij {
  const lanes = [...shelf.pieces].sort((a, b) => a.positie_x_cm - b.positie_x_cm)

  // Breedte-messen op rechterkant van elke lane. Beperkt tot MAX_BREEDTE_MESSEN
  // (machine-constraint: 3 messen). Dedupliceer en sorteer asc.
  const messen_set = new Set<number>()
  for (const lane of lanes) {
    messen_set.add(Math.round(lane.positie_x_cm + lane.placed_x_cm))
  }
  const breedte_messen_cm = Array.from(messen_set)
    .sort((a, b) => a - b)
    .slice(0, MAX_BREEDTE_MESSEN)

  // Lengte-mes = max Y-extent in de shelf (incrementeel; operator zegt "lengte
  // 275" niet "lengte op 600").
  const lengte_mes_cm = Math.round(
    Math.max(...lanes.map((p) => p.placed_y_cm)),
  )
  const lengte_mes_absoluut_cm = Math.round(shelf.y_end_cm)

  const primary_mes_cm = breedte_messen_cm[0] ?? 0
  const is_overgenomen = prev_primary_mes_cm !== null && prev_primary_mes_cm === primary_mes_cm

  return {
    rij_nummer,
    breedte_messen_cm,
    is_breedte_mes_overgenomen: is_overgenomen,
    lengte_mes_cm,
    lengte_mes_absoluut_cm,
    pieces: lanes.map(toKnifeOperation),
  }
}

// ---------------------------------------------------------------------------
// 4. Reststuk-/aangebroken-/afval-conversie.
// ---------------------------------------------------------------------------

function toReststukMarkers(reststukken: ReststukRect[], rolnummer: string): ReststukMarker[] {
  return [...reststukken]
    .sort((a, b) => a.y_cm - b.y_cm || a.x_cm - b.x_cm)
    .map((r, i): ReststukMarker => ({
      letter: `R${i + 1}`,
      rolnummer_volledig: `${rolnummer}-R${i + 1}`,
      breedte_cm: Math.round(r.breedte_cm),
      lengte_cm: Math.round(r.lengte_cm),
      x_start_cm: r.x_cm,
      y_start_cm: r.y_cm,
    }))
}

function toAangebrokenMarker(
  end: { y_cm: number; breedte_cm: number; lengte_cm: number } | null,
): AangebrokenMarker | null {
  if (!end) return null
  return {
    breedte_cm: Math.round(end.breedte_cm),
    lengte_cm: Math.round(end.lengte_cm),
    y_start_cm: end.y_cm,
  }
}

function toAfvalRects(afval: ReststukRect[]): AfvalRect[] {
  return afval.map((r) => ({
    breedte_cm: Math.round(r.breedte_cm),
    lengte_cm: Math.round(r.lengte_cm),
    x_start_cm: r.x_cm,
    y_start_cm: r.y_cm,
  }))
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

export function buildSnijVolgorde(input: BuildSnijVolgordeInput): SnijVolgorde {
  const augmented = input.placements.map(augmentPlacement)
  const shelves = clusterShelves(augmented)

  let prev_primary: number | null = null
  const rijen: Rij[] = shelves.map((shelf, idx) => {
    const rij = buildRij(shelf, idx + 1, prev_primary)
    prev_primary = rij.breedte_messen_cm[0] ?? null
    return rij
  })

  return {
    rolnummer: input.rolnummer,
    rol_breedte_cm: input.rol_breedte_cm,
    rol_lengte_cm: input.rol_lengte_cm,
    rijen,
    reststukken: toReststukMarkers(input.reststukken, input.rolnummer),
    aangebroken_rest: toAangebrokenMarker(input.aangebrokenEnd),
    afval: toAfvalRects(input.afval),
  }
}
