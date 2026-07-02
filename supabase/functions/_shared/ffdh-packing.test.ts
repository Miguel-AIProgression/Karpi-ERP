// Deno test: `deno test supabase/functions/_shared/ffdh-packing.test.ts`
//
// packAcrossRolls-cases zijn verhuisd naar werklijst-packing.test.ts (audit
// 2026-07-02, 0 productie-callers voor de FFDH-variant — zie het commentaar
// op `packAcrossRolls`'s oude plek in ffdh-packing.ts). Dit bestand test nog
// uitsluitend de losse bouwstenen die wél productie-callers hebben
// (reconstructShelves, sortPieces).
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  reconstructShelves,
  sortPieces,
  type Placement,
  type SnijplanPiece,
} from './ffdh-packing.ts'

function piece(
  id: number,
  lengte: number,
  breedte: number,
  afleverdatum: string | null = null,
): SnijplanPiece {
  return {
    id,
    lengte_cm: lengte,
    breedte_cm: breedte,
    maatwerk_vorm: null,
    order_nr: null,
    klant_naam: null,
    afleverdatum,
    area_cm2: lengte * breedte,
    express: false,
  }
}

function placement(
  id: number,
  x: number,
  y: number,
  lengte: number,
  breedte: number,
): Placement {
  return {
    snijplan_id: id,
    positie_x_cm: x,
    positie_y_cm: y,
    lengte_cm: lengte,
    breedte_cm: breedte,
    geroteerd: false,
  }
}

Deno.test('reconstructShelves groepeert plaatsingen per positie_y_cm', () => {
  const placements: Placement[] = [
    placement(1, 0, 0, 240, 340),   // shelf 1 (y=0, h=340)
    placement(2, 0, 340, 170, 170), // shelf 2 (y=340, h=170)
  ]
  const shelves = reconstructShelves(placements, 320)
  assertEquals(shelves.length, 2)
  const shelf1 = shelves.find((s) => s.y === 0)!
  const shelf2 = shelves.find((s) => s.y === 340)!
  assertEquals(shelf1.height, 340)
  assertEquals(shelf1.usedWidth, 240)
  assertEquals(shelf1.maxWidth, 320)
  assertEquals(shelf2.height, 170)
  assertEquals(shelf2.usedWidth, 170)
})

Deno.test('reconstructShelves met twee stukken op dezelfde shelf', () => {
  const placements: Placement[] = [
    placement(1, 0, 0, 100, 200),
    placement(2, 100, 0, 120, 180),
  ]
  const shelves = reconstructShelves(placements, 320)
  assertEquals(shelves.length, 1)
  assertEquals(shelves[0].height, 200) // max van 200 en 180
  assertEquals(shelves[0].usedWidth, 220) // 100 + 120
})

// ---------------------------------------------------------------------------
// Fase 2 (mig 450): express altijd eerst in sortPieces, ongeacht grootte.
// ---------------------------------------------------------------------------

Deno.test('sortPieces: express stuk komt eerst, ondanks veel kleiner', () => {
  const groot = piece(1, 300, 300) // niet-express, groot
  const klein = { ...piece(2, 50, 50), express: true } // express, klein
  const sorted = sortPieces([groot, klein])
  assertEquals(sorted[0].id, 2, 'express stuk staat eerst, ondanks kleinere afmeting')
  assertEquals(sorted[1].id, 1)
})

Deno.test('sortPieces: bij twee express stukken geldt de normale grootte/datum-sortering', () => {
  const a = { ...piece(1, 100, 100, '2026-06-01'), express: true }
  const b = { ...piece(2, 100, 100, '2026-05-01'), express: true }
  const sorted = sortPieces([a, b])
  assertEquals(sorted[0].id, 2, 'gelijke grootte → vroegste afleverdatum wint, ook binnen express')
})

