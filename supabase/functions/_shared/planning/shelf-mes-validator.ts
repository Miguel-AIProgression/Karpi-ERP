// Shelf-mes-validator: controleert per rol of de geplande shelves uitvoerbaar
// zijn met het aantal breedte-messen op de snijmachine.
//
// De machine heeft 3 breedte-messen (+ 1 lengte-mes), wat in één lengte-slag
// tot 4 strips naast elkaar toelaat. Als een shelf meer dan 3 interne
// X-snitposities vereist, kan de operator die rij niet met één slag snijden.
//
// Voor nu is dit een ZACHTE validator: we wijzen geen plaatsingen af, we
// rapporteren alleen. De edge-function-response bevat de waarschuwingen zodat
// ze zichtbaar zijn in de logs en later in de UI. Het packing-algoritme blijft
// ongewijzigd — een hardere constraint in findBestPlacement raakt scoring en
// fallback-paden en is een apart traject.

import type { Placement } from './ffdh-packing.ts'

// Moet gelijk zijn aan BAND_STEP in rol-uitvoer-modal.tsx zodat frontend en
// backend dezelfde shelves afleiden.
const SHELF_BAND_STEP_CM = 5

export const MAX_BREEDTE_MESSEN = 3

export interface RolPlacementsInput {
  rol_id: number
  rolnummer: string
  rol_breedte_cm: number
  plaatsingen: Placement[]
}

export interface ShelfWaarschuwing {
  rol_id: number
  rolnummer: string
  shelf_y_cm: number
  mes_posities_nodig: number[]
  extra_messen: number
}

interface ShelfGroep {
  y: number
  height: number
  placements: Placement[]
}

function bandKey(y: number): number {
  return Math.round(y / SHELF_BAND_STEP_CM)
}

// Groepeert placements op Y-band, vergelijkbaar met de UI-logica in
// rol-uitvoer-modal.tsx (inclusief merge van y-overlappende shelves).
function groepeerShelves(placements: Placement[]): ShelfGroep[] {
  const map = new Map<number, ShelfGroep>()
  for (const p of placements) {
    const k = bandKey(p.positie_y_cm)
    let s = map.get(k)
    if (!s) {
      s = { y: p.positie_y_cm, height: 0, placements: [] }
      map.set(k, s)
    }
    s.placements.push(p)
    const yEnd = p.positie_y_cm + p.breedte_cm
    if (yEnd - s.y > s.height) s.height = yEnd - s.y
  }

  const raw = Array.from(map.values()).sort((a, b) => a.y - b.y)
  const merged: ShelfGroep[] = []
  for (const s of raw) {
    const last = merged[merged.length - 1]
    if (last && s.y < last.y + last.height - 1) {
      last.placements.push(...s.placements)
      const yEnd = Math.max(last.y + last.height, s.y + s.height)
      last.height = yEnd - last.y
    } else {
      merged.push({ y: s.y, height: s.height, placements: [...s.placements] })
    }
  }
  return merged
}

// Geeft de interne X-posities waar een verticale snit door de volledige
// shelf-hoogte loopt zonder een stuk te doorsnijden. Randen (0 en
// rol_breedte) tellen niet — die zijn al door de rol-zijkanten gedekt.
function benodigdeMessen(shelf: ShelfGroep, rolBreedte: number): number[] {
  const xRanges = shelf.placements.map((p) => ({
    start: p.positie_x_cm,
    end: p.positie_x_cm + p.lengte_cm,
  }))

  const kandidaten = new Set<number>()
  for (const p of shelf.placements) {
    if (p.positie_x_cm > 0) kandidaten.add(Math.round(p.positie_x_cm))
    const xEnd = p.positie_x_cm + p.lengte_cm
    if (xEnd < rolBreedte) kandidaten.add(Math.round(xEnd))
  }

  const geldig: number[] = []
  for (const x of kandidaten) {
    const doorsnijdt = xRanges.some((r) => r.start < x && r.end > x)
    if (!doorsnijdt) geldig.push(x)
  }
  return geldig.sort((a, b) => a - b)
}

export function validateShelfMesLimiet(
  rollen: RolPlacementsInput[],
  maxMessen: number = MAX_BREEDTE_MESSEN,
): ShelfWaarschuwing[] {
  const waarschuwingen: ShelfWaarschuwing[] = []

  for (const rol of rollen) {
    if (rol.plaatsingen.length === 0) continue
    const shelves = groepeerShelves(rol.plaatsingen)
    for (const shelf of shelves) {
      const mesPosities = benodigdeMessen(shelf, rol.rol_breedte_cm)
      if (mesPosities.length > maxMessen) {
        waarschuwingen.push({
          rol_id: rol.rol_id,
          rolnummer: rol.rolnummer,
          shelf_y_cm: Math.round(shelf.y),
          mes_posities_nodig: mesPosities,
          extra_messen: mesPosities.length - maxMessen,
        })
      }
    }
  }

  return waarschuwingen
}
