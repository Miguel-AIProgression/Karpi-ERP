// Deno test: `deno test supabase/functions/_shared/guillotine-packing.test.ts`
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  packAcrossRolls,
  packRollGuillotine,
  computeFreeRects,
  computeReststukkenGuillotine,
} from './guillotine-packing.ts'
import type { Placement, Roll, SnijplanPiece } from './ffdh-packing.ts'

function piece(
  id: number,
  lengte: number,
  breedte: number,
  afleverdatum: string | null = null,
  maatwerk_vorm: string | null = null,
): SnijplanPiece {
  return {
    id,
    lengte_cm: lengte,
    breedte_cm: breedte,
    maatwerk_vorm,
    order_nr: null,
    klant_naam: null,
    afleverdatum,
    area_cm2: lengte * breedte,
  }
}

function roll(
  id: number,
  lengte: number,
  breedte: number,
  status: string,
  opts: Partial<Roll> = {},
): Roll {
  return {
    id,
    rolnummer: `R${id}`,
    lengte_cm: lengte,
    breedte_cm: breedte,
    status,
    oppervlak_m2: (lengte * breedte) / 10000,
    sort_priority: status === 'reststuk' ? 1 : 2,
    is_exact: true,
    ...opts,
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

// ---------------------------------------------------------------------------
// Vrije rechthoek berekening
// ---------------------------------------------------------------------------

Deno.test('computeFreeRects: lege rol → één vrije rechthoek', () => {
  const free = computeFreeRects(400, 1500, [])
  assertEquals(free.length, 1)
  assertEquals(free[0], { x: 0, y: 0, width: 400, height: 1500 })
})

Deno.test('computeFreeRects: met één bezette placement in hoek', () => {
  // Placement op (0,0) van 240×340 op rol 400×1500.
  const free = computeFreeRects(400, 1500, [placement(1, 0, 0, 240, 340)])
  // Verwacht 2 vrije rechthoeken (na removeDominated): 160×1500 rechts van
  // placement, 400×1160 onder placement. De 160×340-strook rechts van placed
  // is dominated door de 160×1500 strook, dus verdwijnt.
  const areas = free.map((r) => r.width * r.height).sort((a, b) => b - a)
  assertEquals(free.length, 2)
  assertEquals(areas[0], 400 * 1160)
  assertEquals(areas[1], 160 * 1500)
})

// ---------------------------------------------------------------------------
// Single-roll packing
// ---------------------------------------------------------------------------

Deno.test('packRollGuillotine: klein stuk past in reststuk-achtige ruimte', () => {
  // Rol 400×1500, placement van 240×340 in hoek → nieuw stuk 80×320 moet
  // naast de 240×340 landen (in de 160×1500 strook), NIET onder de placement.
  const initialFree = computeFreeRects(400, 1500, [placement(1, 0, 0, 240, 340)])
  const pieces = [piece(100, 80, 320)]
  const { placed, remaining } = packRollGuillotine(pieces, initialFree, 1500)
  assertEquals(remaining.length, 0)
  assertEquals(placed.length, 1)
  // Placement moet in de 160-wide strip rechts van x=240 landen.
  const p = placed[0]
  assert(p.positie_x_cm >= 240, `verwachtte x >= 240, kreeg ${p.positie_x_cm}`)
  assert(p.positie_y_cm < 340, `verwachtte y < 340, kreeg ${p.positie_y_cm}`)
})

// ---------------------------------------------------------------------------
// Regressie: voorbeeld 2 (IC2900VE16A — FLOORPASSION 80×320 scenario)
// ---------------------------------------------------------------------------

Deno.test('REGRESSIE voorbeeld 2: 80×320 wordt niet op nieuwe shelf gezet', () => {
  // Scenario uit user-rapport:
  //   Rol LAMI 16, 400 cm breed × 1500 cm lang.
  //   Stukken: 240×340 (DERSIMO), 80×320 (FLOORPASSION), 240×240 rond (DERSIMO).
  //
  // FFDH plaatste 80×320 op een nieuwe shelf (y=340), wat resulteerde in
  // gebruikte_lengte=660cm met 3 reststukken.
  // Guillotine moet 80×320 in de vrije ruimte naast 240×340 plaatsen
  // (binnen de eerste 340cm rol-lengte) → gebruikte_lengte ≤ 580cm.
  const pieces = [
    piece(1, 340, 240, '2026-05-04'),          // 240×340 rechthoek
    piece(2, 320, 80, '2026-05-04'),           // 80×320
    piece(3, 240, 240, '2026-05-04', 'rond'),  // 240×240 rond
  ]
  const rolls = [roll(16, 1500, 400, 'beschikbaar')]
  const vormMap = new Map<number, string | null>([
    [1, null],
    [2, null],
    [3, 'rond'],
  ])
  const { rollResults } = packAcrossRolls(pieces, rolls, vormMap)
  assertEquals(rollResults.length, 1)
  const r = rollResults[0]
  assertEquals(r.plaatsingen.length, 3)
  // Gebruikte lengte moet DUIDELIJK minder zijn dan FFDH's 660cm.
  assert(
    r.gebruikte_lengte_cm <= 580,
    `verwachtte gebruikte_lengte ≤ 580, kreeg ${r.gebruikte_lengte_cm}`,
  )
})

// ---------------------------------------------------------------------------
// Regressie: OASI-11 scenario (uit FFDH-testset — 100×100 in shelf-gap)
// ---------------------------------------------------------------------------

Deno.test('OASI-11 regressie: klein stuk landt op rol met bezette placements', () => {
  // Rol OASI 11 heeft al 240×340 + 170×170 als bezette placements.
  // Nieuw stuk 100×100 moet op rol 11 landen (gap-filling), niet op lege rol.
  const pieces = [piece(100, 100, 100, '2026-04-24')]
  const rolls = [
    roll(11, 4620, 320, 'in_snijplan', { has_existing_placements: true }),
    roll(1101, 1500, 320, 'beschikbaar'),
  ]
  const bezetteMap = new Map<number, Placement[]>([
    [11, [
      placement(1, 0, 0, 240, 340),
      placement(2, 0, 340, 170, 170),
    ]],
  ])
  const { rollResults, nietGeplaatst } = packAcrossRolls(
    pieces,
    rolls,
    new Map(),
    { bezetteMap },
  )
  assertEquals(nietGeplaatst.length, 0)
  assertEquals(rollResults.length, 1)
  assertEquals(rollResults[0].rol_id, 11)
})

// ---------------------------------------------------------------------------
// Reststuk-bescherming (parity met FFDH)
// ---------------------------------------------------------------------------

Deno.test('packAcrossRolls: reststuk verworpen als afval > max_pct', () => {
  // Reststuk 500×320 (16 m²), stuk 100×100 (1 m²).
  // Plaatsing op reststuk → gebruikte_lengte=100, afval ≈ 69%.
  // Met max_pct=50: reststuk MOET overgeslagen worden.
  const pieces = [piece(1, 100, 100)]
  const rolls = [
    roll(1, 500, 320, 'reststuk'),
    roll(2, 1500, 320, 'beschikbaar'),
  ]
  const { rollResults } = packAcrossRolls(
    pieces,
    rolls,
    new Map(),
    { maxReststukVerspillingPct: 50 },
  )
  assertEquals(rollResults.length, 1)
  assertEquals(rollResults[0].rol_status, 'beschikbaar')
})

Deno.test('packAcrossRolls: reststuk wel gebruikt als afval onder max_pct', () => {
  // Reststuk 170×150 (2.55 m²), stuk 100×100.
  // Plaatsing op reststuk → gebruikte_lengte=100, afval ≈ 41%.
  const pieces = [piece(1, 100, 100)]
  const rolls = [
    roll(1, 170, 150, 'reststuk'),
    roll(2, 1500, 320, 'beschikbaar'),
  ]
  const { rollResults } = packAcrossRolls(
    pieces,
    rolls,
    new Map(),
    { maxReststukVerspillingPct: 50 },
  )
  assertEquals(rollResults.length, 1)
  assertEquals(rollResults[0].rol_status, 'reststuk')
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

Deno.test('packAcrossRolls: stuk groter dan elke rol → niet geplaatst', () => {
  const pieces = [piece(1, 5000, 500)]
  const rolls = [roll(1, 1000, 320, 'beschikbaar')]
  const { rollResults, nietGeplaatst } = packAcrossRolls(pieces, rolls, new Map())
  assertEquals(rollResults.length, 0)
  assertEquals(nietGeplaatst.length, 1)
})

Deno.test('packAcrossRolls: stuk past na rotatie', () => {
  // Rol 400cm breed, stuk 450×200. Geroteerd: 200×450 — past (200 ≤ 400).
  const pieces = [piece(1, 450, 200)]
  const rolls = [roll(1, 1000, 400, 'beschikbaar')]
  const { rollResults, nietGeplaatst } = packAcrossRolls(pieces, rolls, new Map())
  assertEquals(nietGeplaatst.length, 0)
  assertEquals(rollResults.length, 1)
  assertEquals(rollResults[0].plaatsingen[0].geroteerd, true)
})

Deno.test('packAcrossRolls: meerdere stukken over meerdere rollen', () => {
  // 3 stukken van 200×200 op rollen van 1000×400: alles past op rol 1.
  const pieces = [piece(1, 200, 200), piece(2, 200, 200), piece(3, 200, 200)]
  const rolls = [
    roll(1, 1000, 400, 'beschikbaar'),
    roll(2, 1000, 400, 'beschikbaar'),
  ]
  const { rollResults, nietGeplaatst } = packAcrossRolls(pieces, rolls, new Map())
  assertEquals(nietGeplaatst.length, 0)
  assertEquals(rollResults.length, 1) // alle 3 op eerste rol
  assertEquals(rollResults[0].plaatsingen.length, 3)
})

Deno.test('sortRolls prioriteit: reststuk eerst bij gelijke match-type', () => {
  // Stuk past op beide rollen. Reststuk-rol moet eerst aangeboden.
  const pieces = [piece(1, 100, 100)]
  const vol = roll(2, 1500, 320, 'beschikbaar')
  const rest = roll(1, 300, 200, 'reststuk')
  const { rollResults } = packAcrossRolls(pieces, [vol, rest], new Map())
  assertEquals(rollResults[0].rol_id, 1) // reststuk gekozen ondanks input-volgorde
})

// ---------------------------------------------------------------------------
// Best-of-both: FFDH-winnende scenario moet via FFDH-route, geen regressie
// ---------------------------------------------------------------------------

Deno.test('best-of-both: smalle rol + strip-stukken route via FFDH (geen regressie)', () => {
  // Op een smalle rol (320×500) met 3 strip-achtige stukken (300×100, 300×100,
  // 150×100) presteert FFDH strikt beter (300cm) dan pure Guillotine (350cm).
  // Best-of-both moet FFDH-uitkomst kiezen → gebruikte_lengte 300cm, niet 350.
  const pieces = [piece(1, 300, 100), piece(2, 300, 100), piece(3, 150, 100)]
  const rolls = [roll(1, 500, 320, 'beschikbaar')]
  const { rollResults } = packAcrossRolls(pieces, rolls, new Map())
  assertEquals(rollResults.length, 1)
  const r = rollResults[0]
  assertEquals(r.plaatsingen.length, 3)
  assertEquals(
    r.gebruikte_lengte_cm,
    300,
    `best-of-both moet FFDH's 300cm kiezen, kreeg ${r.gebruikte_lengte_cm}`,
  )
})

// ---------------------------------------------------------------------------
// Regressie K1756006D (FIRE 20) — reststuk-aware rotatie
// ---------------------------------------------------------------------------

Deno.test('REGRESSIE K1756006D: 40×80 moet roteren naar 80×40 zodat 90×180 reststuk ontstaat', () => {
  // Scenario uit user-rapport:
  //   Rol FIRE 20 K1756006D, 400×325 cm (breedte × lengte).
  //   Stukken: 310×220 (FLOORPASSION) + 40×80 (FLOORPASSION).
  //
  // Zonder reststuk-aware scoring kiest het algoritme voor stuk 2 de
  // niet-geroteerde oriëntatie (40×80) op (310,0) → 50×220 + 40×140 afval.
  // Met reststuk-aware scoring moet de geroteerde oriëntatie (80×40) winnen
  // → 10×40 afval + 90×180 reststuk.
  //
  // Validatie: placement op y=0 voor beide stukken (gebruikte_lengte = 220)
  // EN placement van stuk 2 heeft breedte ≥ 70 langs de lengte-as zodat er
  // onder een reststuk-kwalificerende ruimte ontstaat.
  const pieces = [piece(1, 310, 220), piece(2, 80, 40)]
  const rolls = [roll(16, 325, 400, 'beschikbaar')]
  const { rollResults } = packAcrossRolls(pieces, rolls, new Map())
  assertEquals(rollResults.length, 1)
  const r = rollResults[0]
  assertEquals(r.plaatsingen.length, 2)
  assertEquals(r.gebruikte_lengte_cm, 220)

  const stuk2 = r.plaatsingen.find((p) => p.snijplan_id === 2)!
  assert(
    stuk2.positie_x_cm >= 310,
    `stuk 2 moet rechts van stuk 1 (x≥310), kreeg ${stuk2.positie_x_cm}`,
  )
  // De geroteerde oriëntatie heeft placedHeight=40 (de 80-kant langs rol-breedte).
  // Dat is de waarde in placement.breedte_cm (Y-as).
  assertEquals(
    stuk2.breedte_cm,
    40,
    `stuk 2 moet geroteerd gesneden worden (Y-dim = 40), kreeg ${stuk2.breedte_cm}`,
  )
})

// ---------------------------------------------------------------------------
// Spec-voorbeeld (user-provided): 400×15000 rol met 4 orders
// ---------------------------------------------------------------------------

Deno.test('SPEC regressie: 4-order rol consumeert exact 820 cm rol-lengte', () => {
  // Uit user-spec: rol 400×15000, orders 2× 200×200 + 1× 330×220 + 1× 400×400.
  // Optimale indeling:
  //   - 400×400 (volle breedte)
  //   - 400×220 strook (330×220 + 70×220 afval naast)
  //   - 200×200 + 200×200 naast elkaar (samen 400×200)
  // Totaal gebruikte rol-lengte: 400+220+200 = 820 cm.
  // Afval binnen gebruikt oppervlak: 70×220 = 15.400 cm² ≈ 4,7% van (400×820).
  const pieces = [
    piece(1, 400, 400),
    piece(2, 330, 220),
    piece(3, 200, 200),
    piece(4, 200, 200),
  ]
  const rolls = [roll(1, 15000, 400, 'beschikbaar')]
  const { rollResults } = packAcrossRolls(pieces, rolls, new Map())
  assertEquals(rollResults.length, 1)
  const r = rollResults[0]
  assertEquals(r.plaatsingen.length, 4)
  assertEquals(
    r.gebruikte_lengte_cm,
    820,
    `spec zegt 820cm, kreeg ${r.gebruikte_lengte_cm}`,
  )
  // Afval-percentage in gebruikte zone: 70*220 / (400*820) ≈ 4.7%
  assert(
    r.afval_percentage >= 4 && r.afval_percentage <= 6,
    `verwachtte 4-6% afval, kreeg ${r.afval_percentage}%`,
  )
})

// ---------------------------------------------------------------------------
// Reststuk-berekening
// ---------------------------------------------------------------------------

Deno.test('computeReststukkenGuillotine: returnt alle vrije rechthoeken >= min', () => {
  // Rol 400×1500, één stuk van 240×340 in hoek → vrije ruimte:
  //   - 160×1500 strip rechts
  //   - 400×1160 strip onder
  const plaatsingen = [placement(1, 0, 0, 240, 340)]
  const rest = computeReststukkenGuillotine(400, 1500, plaatsingen, 70, 140)
  assertEquals(rest.length, 2)
})

Deno.test('computeReststukkenGuillotine: filtert te kleine stukken', () => {
  // Rol 400×200, placement 380×180 in hoek → reststukken zijn slechts 20×200
  // en 400×20, beide onder min_short=70.
  const plaatsingen = [placement(1, 0, 0, 380, 180)]
  const rest = computeReststukkenGuillotine(400, 200, plaatsingen, 70, 140)
  assertEquals(rest.length, 0)
})
