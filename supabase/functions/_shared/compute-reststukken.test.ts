// Deno test: `deno test supabase/functions/_shared/compute-reststukken.test.ts`
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { computeReststukken } from './compute-reststukken.ts'
import type { Placement } from './ffdh-packing.ts'

function p(
  snijplan_id: number,
  x: number,
  y: number,
  lengte: number,
  breedte: number,
): Placement {
  return {
    snijplan_id,
    positie_x_cm: x,
    positie_y_cm: y,
    lengte_cm: lengte,
    breedte_cm: breedte,
    geroteerd: false,
  }
}

Deno.test('lege rol geeft één groot reststuk als afmeting kwalificeert', () => {
  const r = computeReststukken(1000, 400, [])
  assertEquals(r.length, 1)
  assertEquals(r[0], { x_cm: 0, y_cm: 0, breedte_cm: 400, lengte_cm: 1000 })
})

Deno.test('shelf rechter-strip wordt gedetecteerd (80x300 naast 320x300)', () => {
  // Rol 400 breed x 1000 lang, één stuk 320x300 linksboven
  const plaatsingen = [p(1, 0, 0, 320, 300)]
  const r = computeReststukken(1000, 400, plaatsingen)

  const rechterStrip = r.find(
    (x) => x.x_cm === 320 && x.y_cm === 0 && x.breedte_cm === 80 && x.lengte_cm === 300,
  )
  assertEquals(rechterStrip !== undefined, true, 'verwacht 80x300 strip rechts van stuk')
})

Deno.test('end-of-roll strip wordt gedetecteerd na laatste shelf', () => {
  // Rol 400x1000, stuk 400x300 vult eerste shelf volledig. Rest: 400x700 onderaan.
  const plaatsingen = [p(1, 0, 0, 400, 300)]
  const r = computeReststukken(1000, 400, plaatsingen)

  const eind = r.find(
    (x) => x.x_cm === 0 && x.y_cm === 300 && x.breedte_cm === 400 && x.lengte_cm === 700,
  )
  assertEquals(eind !== undefined, true, 'verwacht 400x700 end-of-roll strip')
})

Deno.test('sliver onder korter stuk wordt gedetecteerd', () => {
  // Shelf hoogte 300 (piece A=300), piece B=250 hoog ernaast → sliver 50 onder B
  // Met min 70x140 filter valt een 150x50 sliver weg (short=50 < 70)
  const plaatsingen = [
    p(1, 0, 0, 200, 300), // A
    p(2, 200, 0, 150, 250), // B (korter)
  ]
  // Met lagere threshold voor test
  const r = computeReststukken(500, 400, plaatsingen, 30, 100)
  const sliver = r.find(
    (x) => x.x_cm === 200 && x.y_cm === 250 && x.breedte_cm === 150 && x.lengte_cm === 50,
  )
  // 150x50 → short=50, long=150 → voldoet aan (30, 100)
  assertEquals(sliver !== undefined, true, 'verwacht 150x50 sliver onder korter stuk')
})

Deno.test('te klein reststuk wordt uitgefilterd (< 70x140)', () => {
  // Rol 400x1000, stuk 350x900 → rechter strip 50x900 (short=50 < 70 → afval)
  //                            → end strip 400x100 (long=400, short=100, maar long 400 ok maar short=100 >= 70 én long=400 >= 140 → OK)
  const plaatsingen = [p(1, 0, 0, 350, 900)]
  const r = computeReststukken(1000, 400, plaatsingen)

  const tesmal = r.find((x) => x.breedte_cm === 50)
  assertEquals(tesmal, undefined, 'strip 50 cm breed moet weggefilterd zijn')

  const eind = r.find((x) => x.y_cm === 900)
  assertEquals(eind !== undefined, true, 'end strip 400x100 moet blijven')
})

Deno.test('screenshot-scenario: 320x300 stuk geeft 80x300 reststuk', () => {
  // Mirror van het probleem uit de UI: rol 400 breed, stuk 320x300 → 80x300 reststuk
  const plaatsingen = [p(1, 0, 0, 320, 300)]
  const r = computeReststukken(1200, 400, plaatsingen)

  const reststuk = r.find((x) => x.breedte_cm === 80 && x.lengte_cm === 300)
  assertEquals(
    reststuk !== undefined,
    true,
    '80x300 reststuk moet herkend worden (short=80>=70, long=300>=140)',
  )
})
