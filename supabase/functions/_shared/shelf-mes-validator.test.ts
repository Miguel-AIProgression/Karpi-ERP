// Deno unit tests voor shelf-mes-validator.ts
// Run: deno test supabase/functions/_shared/shelf-mes-validator.test.ts

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { validateShelfMesLimiet, type RolPlacementsInput } from './shelf-mes-validator.ts'
import type { Placement } from './ffdh-packing.ts'

function placement(id: number, x: number, y: number, lengte: number, breedte: number): Placement {
  return {
    snijplan_id: id,
    positie_x_cm: x,
    positie_y_cm: y,
    lengte_cm: lengte,    // X-axis dimensie (over de rolbreedte)
    breedte_cm: breedte,  // Y-axis dimensie (langs de rollengte)
    geroteerd: false,
  }
}

Deno.test('lege plaatsingen → geen waarschuwingen', () => {
  const result = validateShelfMesLimiet([])
  assertEquals(result.length, 0)
})

Deno.test('een stuk dat de volle rol-breedte vult → 0 messen nodig', () => {
  const input: RolPlacementsInput = {
    rol_id: 1,
    rolnummer: 'R1',
    rol_breedte_cm: 400,
    plaatsingen: [placement(1, 0, 0, 400, 300)],
  }
  assertEquals(validateShelfMesLimiet([input]).length, 0)
})

Deno.test('twee stukken naast elkaar → 1 mes nodig, onder de limiet', () => {
  // VERR 13 rij 1: 220x220 + 160x220 op dezelfde Y-band
  const input: RolPlacementsInput = {
    rol_id: 1,
    rolnummer: 'VERR130-C',
    rol_breedte_cm: 400,
    plaatsingen: [
      placement(1, 0, 0, 220, 220),
      placement(2, 220, 0, 160, 220),
    ],
  }
  assertEquals(validateShelfMesLimiet([input]).length, 0)
})

Deno.test('RUBI 26: 3 strips (176+86+rest) → 2 messen, onder de limiet', () => {
  // Shelf met 176x306 + 86x306. Derde strip (58x306) is afval,
  // geen placement, maar de snit op x=262 is nog steeds nodig voor de kant
  // van het 86-stuk. Kant op x=0 en x=320 tellen als rol-randen, niet mee.
  const input: RolPlacementsInput = {
    rol_id: 2,
    rolnummer: 'RUBI26-1',
    rol_breedte_cm: 320,
    plaatsingen: [
      placement(10, 0, 0, 176, 306),
      placement(11, 176, 0, 86, 306),
    ],
  }
  const result = validateShelfMesLimiet([input])
  assertEquals(result.length, 0) // 2 messen nodig (176 + 262), dus onder limiet 3
})

Deno.test('5 strips op één shelf → 4 messen, boven limiet 3', () => {
  // Synthetisch: rol 500 breed, 5 stukken naast elkaar van 100 breed.
  // Mes-posities nodig: 100, 200, 300, 400 = 4 messen. Over de limiet.
  const input: RolPlacementsInput = {
    rol_id: 3,
    rolnummer: 'SYNTH-5',
    rol_breedte_cm: 500,
    plaatsingen: [
      placement(20, 0,   0, 100, 200),
      placement(21, 100, 0, 100, 200),
      placement(22, 200, 0, 100, 200),
      placement(23, 300, 0, 100, 200),
      placement(24, 400, 0, 100, 200),
    ],
  }
  const result = validateShelfMesLimiet([input])
  assertEquals(result.length, 1)
  assertEquals(result[0].mes_posities_nodig, [100, 200, 300, 400])
  assertEquals(result[0].extra_messen, 1)
  assertEquals(result[0].rol_id, 3)
})

Deno.test('twee shelves, één overschrijdt limiet', () => {
  const input: RolPlacementsInput = {
    rol_id: 4,
    rolnummer: 'MIX',
    rol_breedte_cm: 500,
    plaatsingen: [
      // Shelf 1 y=0: 2 strips → 1 mes, ok
      placement(30, 0,   0,   250, 200),
      placement(31, 250, 0,   250, 200),
      // Shelf 2 y=200: 5 strips → 4 messen, te veel
      placement(32, 0,   200, 100, 150),
      placement(33, 100, 200, 100, 150),
      placement(34, 200, 200, 100, 150),
      placement(35, 300, 200, 100, 150),
      placement(36, 400, 200, 100, 150),
    ],
  }
  const result = validateShelfMesLimiet([input])
  assertEquals(result.length, 1)
  assertEquals(result[0].shelf_y_cm, 200)
})

Deno.test('verticaal gestapelde stukken binnen zelfde kolom → geen extra mes', () => {
  // Een shelf waar een 200x100 bovenop een 200x50 staat in dezelfde kolom:
  // er is nog steeds maar 1 interne X-transitie nodig (x=200), niet 2.
  const input: RolPlacementsInput = {
    rol_id: 5,
    rolnummer: 'STACK',
    rol_breedte_cm: 400,
    plaatsingen: [
      placement(40, 0,   0,   200, 150),
      placement(41, 200, 0,   200, 100),
      placement(42, 200, 100, 200, 50),
    ],
  }
  assertEquals(validateShelfMesLimiet([input]).length, 0)
})

Deno.test('Y-band tolerantie (5 cm): stukken op y=0 en y=2 tellen als één shelf', () => {
  const input: RolPlacementsInput = {
    rol_id: 6,
    rolnummer: 'TOL',
    rol_breedte_cm: 500,
    plaatsingen: [
      placement(50, 0,   0, 100, 200),
      placement(51, 100, 2, 100, 200),  // y=2 valt in zelfde 5cm-band als y=0
      placement(52, 200, 0, 100, 200),
      placement(53, 300, 0, 100, 200),
      placement(54, 400, 0, 100, 200),
    ],
  }
  const result = validateShelfMesLimiet([input])
  assertEquals(result.length, 1, 'alle 5 stukken in één shelf → 4 messen nodig')
})
