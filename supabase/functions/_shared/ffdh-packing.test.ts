// Deno test: `deno test supabase/functions/_shared/ffdh-packing.test.ts`
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  reconstructShelves,
  packAcrossRolls,
  type Placement,
  type Roll,
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

Deno.test('packAcrossRolls zonder bezetteMap: bestaand gedrag blijft', () => {
  // Twee stukken, één rol — moet op dezelfde rol gepackt worden.
  const pieces = [piece(1, 100, 100), piece(2, 100, 100)]
  const rolls = [roll(1, 1000, 320, 'beschikbaar')]
  const { rollResults, nietGeplaatst } = packAcrossRolls(
    pieces,
    rolls,
    new Map(),
  )
  assertEquals(nietGeplaatst.length, 0)
  assertEquals(rollResults.length, 1)
  assertEquals(rollResults[0].plaatsingen.length, 2)
})

Deno.test('packAcrossRolls: nieuw stuk landt in shelf-gap van deels-geplande rol', () => {
  // Scenario Miguel: rol OASI 11 heeft al 240×340 (shelf 1) en 170×170 (shelf 2).
  // Nieuw stuk 100×100 komt binnen — moet in gap van shelf 2 (naast 170×170)
  // landen, NIET op een aparte rol.
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
  assertEquals(rollResults[0].rol_id, 11) // op rol OASI 11, niet 1101
  assertEquals(rollResults[0].plaatsingen[0].snijplan_id, 100)
  assertEquals(rollResults[0].plaatsingen[0].positie_y_cm, 340) // op shelf 2
})

Deno.test('packAcrossRolls: reststuk verworpen als afval > max_pct', () => {
  // Reststuk 500×320 (16 m²), stuk 100×100 (1 m²) → afval 99% bij plaatsing
  // op reststuk. Met max_pct=50: reststuk MOET overgeslagen worden.
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
  assertEquals(rollResults[0].rol_status, 'beschikbaar') // niet 'reststuk'
})

Deno.test('packAcrossRolls: reststuk wel gebruikt als afval onder max_pct', () => {
  // Reststuk 150×170 (2.55 m²), stuk 100×100 (1 m²). Bij plaatsing:
  // gebruikte_lengte=100, afval ≈ 100*170-100*100 / (100*170) ≈ 41%.
  // Met max_pct=50: MOET reststuk gebruikt worden.
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

Deno.test('sortRolls: rol met bestaande plaatsingen komt eerst', () => {
  const pieces = [piece(1, 100, 100)]
  const rollA = roll(1, 4620, 320, 'in_snijplan', { has_existing_placements: true })
  const rollB = roll(2, 1500, 320, 'beschikbaar')
  // Stop bezetteMap leeg: de test kijkt alleen naar sortering-effect.
  // Als rol A eerst komt, landt het 100×100 daarop.
  const { rollResults } = packAcrossRolls(
    pieces,
    [rollB, rollA], // volgorde omgekeerd in input
    new Map(),
  )
  assertEquals(rollResults[0].rol_id, 1) // rol A ondanks dat hij als tweede binnenkwam
})
