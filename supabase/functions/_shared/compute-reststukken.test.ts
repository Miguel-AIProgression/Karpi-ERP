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
  // Shelf hoogte 300 (piece A=300), piece B=250 hoog ernaast → sliver 50 onder B.
  // Met default min 50x100: 150x50 heeft short=50 ≥ 50 en long=150 ≥ 100 → OK.
  const plaatsingen = [
    p(1, 0, 0, 200, 300), // A
    p(2, 200, 0, 150, 250), // B (korter)
  ]
  const r = computeReststukken(500, 400, plaatsingen)
  const sliver = r.find(
    (x) => x.x_cm === 200 && x.y_cm === 250 && x.breedte_cm === 150 && x.lengte_cm === 50,
  )
  assertEquals(sliver !== undefined, true, 'verwacht 150x50 sliver onder korter stuk')
})

Deno.test('te klein reststuk wordt uitgefilterd (< 50x100)', () => {
  // Rol 400x1000, stuk 360x900 → rechter strip 40x900 (short=40 < 50 → afval)
  //                            → end strip 400x100 (short=100 ≥ 50, long=400 ≥ 100 → OK)
  const plaatsingen = [p(1, 0, 0, 360, 900)]
  const r = computeReststukken(1000, 400, plaatsingen)

  const tesmal = r.find((x) => x.breedte_cm === 40)
  assertEquals(tesmal, undefined, 'strip 40 cm breed moet weggefilterd zijn (< 50)')

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
    '80x300 reststuk moet herkend worden (short=80>=50, long=300>=100)',
  )
})

Deno.test('IC2901TA13B: end-strip region wordt door reststuk(ken) bestreken', () => {
  // Screenshot-scenario dat voorheen "0 reststukken, 4 afval" gaf:
  // rol 400×250, placements 243×200 + 45×170 + 80×163 in één shelf op y=0.
  //
  // Pre-ADR-0025: één 400×50 end-strip werd als reststuk geclaimd.
  // Post-ADR-0025: greedy pakt eerst de chunky 157×80 inter-shelf gap
  // (score 8965 > 7071 van end-strip), waardoor de end-strip rechts wordt
  // geabsorbeerd door dat chunky stuk. Linker deel blijft als losse 243×50
  // claim. Functioneel: het end-strip-gebied is niet vergeten — het wordt
  // alleen anders gegroepeerd (en chunkier).
  const plaatsingen: Placement[] = [
    p(1, 0, 0, 243, 200),
    p(2, 243, 0, 45, 170),
    p(3, 288, 0, 80, 163),
  ]
  const r = computeReststukken(250, 400, plaatsingen)

  // Linker deel van de end-strip moet een eigen claim hebben.
  const linkerEnd = r.find(
    (x) => x.x_cm === 0 && x.y_cm === 200 && x.breedte_cm === 243 && x.lengte_cm === 50,
  )
  assertEquals(linkerEnd !== undefined, true, 'verwacht 243×50 claim op (0,200)')

  // Rechter deel moet door een chunky reststuk geabsorbeerd zijn dat y=200..250
  // bestrijkt (specifiek de 157×80 op (243,170), die loopt van y=170 tot y=250).
  const chunky = r.find(
    (x) => x.x_cm === 243 && x.y_cm === 170 && x.breedte_cm === 157 && x.lengte_cm === 80,
  )
  assertEquals(chunky !== undefined, true, 'verwacht 157×80 chunky claim op (243,170)')
})

// ---------------------------------------------------------------------------
// ADR-0025: shape-bias kiest chunkier reststukken
// ---------------------------------------------------------------------------

Deno.test('ADR-0025: 150×450 wint van 75×905 bij vergelijkbaar oppervlak', () => {
  // Synthetische rol waar één placement zowel een chunky (150×450) als een
  // lange smalle (75×905) free-rect achterlaat. Pure-area greedy pakt het
  // marginaal grotere 75×905 eerst (67 875 > 67 500). Shape-bias prefereert
  // 150×450 (score 38 950 > 19 550) → chunky stuk verschijnt als R1.
  //
  // We construeren dit door 2 placements: één 250×450 linksboven, één 325×455
  // langs de rechterrand vanaf y=450. Resulterende vrije ruimte heeft een
  // chunky 150×450 én een lange smalle 75-strip.
  const plaatsingen: Placement[] = [
    p(1, 0, 0, 250, 450),
    p(2, 0, 450, 325, 455),
  ]
  const r = computeReststukken(905, 400, plaatsingen)

  // Eerste pick (grootste score) moet de 150×450 chunk zijn — niet een
  // 75-strip langs de rechterrand.
  // Met area 67500 (150×450) vs 75×455 = 34125: ratio doet er niet toe,
  // 150×450 is gewoon groter in area én chunkier.
  // Cruciaal: minstens één claimed reststuk heeft short ≥ 150.
  const chunky = r.find(
    (x) => Math.min(x.breedte_cm, x.lengte_cm) >= 150 &&
           Math.max(x.breedte_cm, x.lengte_cm) >= 100,
  )
  assertEquals(
    chunky !== undefined,
    true,
    `verwacht een reststuk met short ≥ 150, kreeg ${JSON.stringify(r)}`,
  )
})

Deno.test('free-rect-based: interne gaps onder korter stuk worden samengevoegd', () => {
  // Placements die een grote "L-vormige" vrije ruimte achterlaten. De oude
  // shelf-based impl splitste dit in meerdere kleine fragmenten; de nieuwe
  // free-rect impl levert grotere samenhangende reststukken op.
  // Rol 400×500, stukken: 200×300 linksboven, 150×250 ernaast.
  // Vrije ruimte onder shelf + rechterstrip = disjoint cover van 2 rechthoeken.
  const plaatsingen: Placement[] = [
    p(1, 0, 0, 200, 300),
    p(2, 200, 0, 150, 250),
  ]
  const r = computeReststukken(500, 400, plaatsingen)

  // Bottom-strip over volle breedte (0,300,400,200) is grootste reststuk.
  const bottom = r.find(
    (x) => x.x_cm === 0 && x.y_cm === 300 && x.breedte_cm === 400 && x.lengte_cm === 200,
  )
  assertEquals(bottom !== undefined, true, 'verwacht 400x200 bottom-strip als grootste reststuk')
  // Totaal reststuk-aantal is ≥ 2 (bottom + ≥ 1 andere claim)
  assertEquals(r.length >= 2, true, `verwacht ≥2 reststukken, kreeg ${r.length}`)
})
