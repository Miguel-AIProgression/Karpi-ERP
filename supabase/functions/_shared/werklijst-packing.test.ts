// Fase (b) — packing-verificatie voor de snijderij werklijst.
// Deno test: `deno test supabase/functions/_shared/werklijst-packing.test.ts`
//
// Controleert dat het FFDH-algoritme "naast-elkaar" correct implementeert —
// het kernmechanisme achter de werklijst-shelf-weergave.
//
// Alle stukken krijgen placed_lengte_cm / placed_breedte_cm mee:
//   placed_lengte_cm → piece.lengte_cm  (X-as, rolbreedte-richting)
//   placed_breedte_cm → piece.breedte_cm (Y-as, rollengterichting)
// De marge zit al ingebakken in de placed-dimensies (via SQL stuk_snij_marge_cm,
// mig 464). De packer ontvangt en werkt uitsluitend met placed-dimensies.
//
// Marge-waarden (mig 464, huidige productie):
//   rechthoek       : 0 cm  (geen marge)
//   rond / ovaal    : 2.5 cm per zijde (was 5 cm vóór mig 464)
//   ZO-afwerking    : 6 cm  per zijde (stofovermaat)
//   exact rolbreedte: 0 cm  (mig 463, uitzondering bij kortste zijde = rol_breedte)

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  packRoll,
  sortPieces,
  sortRolls,
  reconstructShelves,
  calcRollStats,
  type PackOptions,
  type PackingResult,
  type Placement,
  type Roll,
  type SnijplanPiece,
  type UnplacedPiece,
} from './ffdh-packing.ts'

// Test-driver: FFDH-multi-rol-orchestratie, verplaatst uit ffdh-packing.ts
// (audit 2026-07-02). In productie orkestreert guillotine-packing.ts::
// packAcrossRolls; deze FFDH-variant had 0 productie-callers en leeft nu
// alleen hier om het shelf-mechanisme achter de werklijst te karakteriseren.
function packAcrossRolls(
  pieces: SnijplanPiece[],
  rolls: Roll[],
  pieceVormMap: Map<number, string | null>,
  options: PackOptions = {},
): PackingResult {
  const { bezetteMap, maxReststukVerspillingPct } = options
  const sortedPieces = sortPieces(pieces)
  const sortedRolls = sortRolls(rolls)

  let unplacedPieces = [...sortedPieces]
  const rollResults: PackingResult['rollResults'] = []

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

// ─── Hulp-factories ──────────────────────────────────────────────────────────

function stuk(
  id: number,
  lengte_cm: number,   // X-as (placed, incl. marge)
  breedte_cm: number,  // Y-as (placed, incl. marge)
  opts: Partial<Pick<SnijplanPiece, 'express' | 'afleverdatum' | 'maatwerk_vorm'>> = {},
): SnijplanPiece {
  return {
    id,
    lengte_cm,
    breedte_cm,
    maatwerk_vorm: opts.maatwerk_vorm ?? null,
    order_nr: null,
    klant_naam: null,
    afleverdatum: opts.afleverdatum ?? null,
    area_cm2: lengte_cm * breedte_cm,
    express: opts.express ?? false,
  }
}

function rol(
  id: number,
  breedte_cm: number,
  lengte_cm: number,
  opts: Partial<Pick<Roll, 'status' | 'has_existing_placements'>> = {},
): Roll {
  const status = opts.status ?? 'beschikbaar'
  return {
    id,
    rolnummer: `R${id}`,
    lengte_cm,
    breedte_cm,
    status,
    oppervlak_m2: (lengte_cm * breedte_cm) / 10000,
    sort_priority: status === 'reststuk' ? 1 : 2,
    is_exact: true,
    has_existing_placements: opts.has_existing_placements,
  }
}

function plaatsing(id: number, x: number, y: number, lengte: number, breedte: number): Placement {
  return {
    snijplan_id: id,
    positie_x_cm: x,
    positie_y_cm: y,
    lengte_cm: lengte,
    breedte_cm: breedte,
    geroteerd: false,
  }
}

// ─── Marge-documentatietest ───────────────────────────────────────────────────

// Dit is een documentatie-test: legt vast welke placed-dimensies de packer
// verwacht te ontvangen voor de drie klassen stukken die in de werklijst
// voorkomen. De SQL-functie stuk_snij_marge_cm (mig 464) is de bron-van-waarheid;
// deze test dient als leesbare specificatie voor wie de koppeling controleert.
Deno.test('marge-specificatie: placed-dimensies per stuktype (documentatie)', () => {
  // Rechthoek 200×300 cm, geen marge:
  const rect = stuk(1, 200, 300)
  assertEquals(rect.lengte_cm, 200)
  assertEquals(rect.breedte_cm, 300)

  // Rond stuk 200×200 cm, marge 2.5 cm per zijde:
  const rond = stuk(2, 202.5, 202.5, { maatwerk_vorm: 'rond' })
  assertEquals(rond.lengte_cm, 202.5)   // 200 + 2.5
  assertEquals(rond.breedte_cm, 202.5)  // 200 + 2.5

  // ZO-afwerking 150×400 cm, marge 6 cm per zijde:
  const zo = stuk(3, 156, 406)
  assertEquals(zo.lengte_cm, 156)   // 150 + 6
  assertEquals(zo.breedte_cm, 406)  // 400 + 6
})

// ─── Sorteervolgordetest ──────────────────────────────────────────────────────

Deno.test('sortPieces: grootste max-dimensie eerst (express overschrijft)', () => {
  // ZO-stuk (max=406) → rect (max=300) → rond (max=202.5)
  const zo   = stuk(3, 156, 406) // max=406
  const rect = stuk(1, 200, 300) // max=300
  const rond = stuk(2, 202.5, 202.5) // max=202.5

  const sorted = sortPieces([rect, rond, zo])
  assertEquals(sorted.map((s) => s.id), [3, 1, 2])
})

// ─── Drie-stukken-scenario (kern van de werklijst) ───────────────────────────

// Dit is het referentiescenario uit de fase (b) planning:
//   Rol 400 cm breed × 1000 cm lang
//   Stuk 1 (rect  200×300 ): placed lengte=200, breedte=300 (marge 0)
//   Stuk 2 (rond  200×200 ): placed lengte=202.5, breedte=202.5 (marge 2.5)
//   Stuk 3 (ZO   150×400 ): placed lengte=156, breedte=406 (marge 6)
//
// Verwacht na FFDH-sortering (max-dim → sort: ZO=406, rect=300, rond=202.5):
//   ZO   → shelf y=0, x=0  (400−156=244 gap, past rect erin → tier 2)
//   rect → shelf y=0, x=156 (existing shelf, tier 3 beter dan nieuw tier 4)
//   rond → shelf y=406, x=0 (geen ruimte meer op shelf 0: 356+202.5>400)
//
// Naast-elkaar: ZO + rect liggen op dezelfde shelf (positie_y = 0).
Deno.test('drie-stukken-scenario: ZO en rect naast-elkaar op shelf y=0, rond apart op y=406', () => {
  const r = rol(1, 400, 1000) // breedte=400 (X), lengte=1000 (Y)
  const pieces = [
    stuk(1, 200, 300),        // rect
    stuk(2, 202.5, 202.5),    // rond (placed incl. 2.5 cm marge)
    stuk(3, 156, 406),        // ZO (placed incl. 6 cm marge)
  ]

  const { rollResults, nietGeplaatst } = packAcrossRolls(
    pieces,
    [r],
    new Map([[1, null], [2, 'rond'], [3, null]]),
  )

  assertEquals(nietGeplaatst.length, 0, 'alle drie stukken moeten passen')
  assertEquals(rollResults.length, 1, 'één rol gebruikt')

  const plaatsingen = rollResults[0].plaatsingen
  assertEquals(plaatsingen.length, 3, 'drie plaatsingen')

  // Zoek per stuk
  const p3 = plaatsingen.find((p) => p.snijplan_id === 3)!
  const p1 = plaatsingen.find((p) => p.snijplan_id === 1)!
  const p2 = plaatsingen.find((p) => p.snijplan_id === 2)!

  // ZO-stuk: eerste op shelf y=0, x=0
  assertEquals(p3.positie_y_cm, 0, 'ZO start op y=0')
  assertEquals(p3.positie_x_cm, 0, 'ZO start op x=0')
  assertEquals(p3.lengte_cm, 156, 'ZO breedte 156 cm (X)')
  assertEquals(p3.breedte_cm, 406, 'ZO hoogte 406 cm (Y)')

  // Rect: naast-elkaar met ZO op dezelfde shelf
  assertEquals(p1.positie_y_cm, 0, 'rect staat op dezelfde shelf als ZO (naast-elkaar)')
  assertEquals(p1.positie_x_cm, 156, 'rect begint direct rechts van ZO')
  assertEquals(p1.lengte_cm, 200, 'rect breedte 200 cm (X)')
  assertEquals(p1.breedte_cm, 300, 'rect hoogte 300 cm (Y)')

  // Rond: eigen shelf na de ZO
  assertEquals(p2.positie_y_cm, 406, 'rond krijgt een eigen shelf op y=406')
  assertEquals(p2.positie_x_cm, 0, 'rond staat links op de nieuwe shelf')
  assertEquals(p2.lengte_cm, 202.5, 'rond breedte 202.5 cm (X, incl. 2.5 cm marge)')
  assertEquals(p2.breedte_cm, 202.5, 'rond hoogte 202.5 cm (Y, incl. 2.5 cm marge)')

  // Totale gebruikte rollengte
  assertEquals(rollResults[0].gebruikte_lengte_cm, 608.5, 'gebruikte rollengte = 406 + 202.5 cm')
})

// ─── Shelf-breedte-overflow-bewijs ───────────────────────────────────────────

Deno.test('naast-elkaar: twee stukken passen samen op een 400 cm-rol (356 ≤ 400)', () => {
  // ZO (156 cm) + rect (200 cm) = 356 cm ≤ 400 cm — dit bewijst dat ze
  // daadwerkelijk naast-elkaar passen zonder de rolbreedte te overschrijden.
  const r = rol(1, 400, 1000)
  const pieces = [stuk(3, 156, 406), stuk(1, 200, 300)]

  const { rollResults } = packAcrossRolls(pieces, [r], new Map())
  assertEquals(rollResults.length, 1)

  const plaatsingen = rollResults[0].plaatsingen
  const p3 = plaatsingen.find((p) => p.snijplan_id === 3)!
  const p1 = plaatsingen.find((p) => p.snijplan_id === 1)!

  // Beide op y=0 → naast-elkaar
  assertEquals(p3.positie_y_cm, 0)
  assertEquals(p1.positie_y_cm, 0)

  // Samen 356 cm, rol is 400 cm — past zonder overflow
  const totaalBreedte = p3.positie_x_cm + p3.lengte_cm + p1.lengte_cm
  assertEquals(totaalBreedte, 356)
})

// ─── ZO-stuk te breed voor de rol ────────────────────────────────────────────

Deno.test('ZO-stuk breder dan rol (406 > 400) kan niet geplaatst worden zonder rotatie', () => {
  // Het ZO-stuk heeft placed_breedte_cm=406 — breder dan de 400 cm-rol.
  // Rotatie geeft (w=406, h=156): 406 > 400 → ook te breed.
  // Resultaat: niet geplaatst.
  const r = rol(1, 400, 1000)
  const zoTeBreed = stuk(99, 406, 406) // beide zijden 406 > 400

  const { rollResults, nietGeplaatst } = packAcrossRolls([zoTeBreed], [r], new Map())
  assertEquals(rollResults.length, 0, 'rol mag niet gebruikt worden voor een onplaatsbaar stuk')
  assertEquals(nietGeplaatst.length, 1, 'het ZO-stuk moet terugkomen als niet-geplaatst')
  assertEquals(nietGeplaatst[0].snijplan_id, 99)
})

// ─── Twee rechthoeken naast-elkaar ───────────────────────────────────────────

Deno.test('twee passende rechthoeken landen naast-elkaar op shelf y=0', () => {
  // Stuk A 200×300, stuk B 180×290. Max-dim: A(300) > B(290) → A eerst.
  // shelf y=0 na A: hoogte=300, breedte_gebruikt=200, gap=200.
  // B (h=290≤300, 200+180=380≤400) past in het gap → naast-elkaar.
  const r = rol(1, 400, 2000)
  const a = stuk(10, 200, 300)
  const b = stuk(11, 180, 290)

  const { rollResults, nietGeplaatst } = packAcrossRolls([a, b], [r], new Map())
  assertEquals(nietGeplaatst.length, 0)

  const plaatsingen = rollResults[0].plaatsingen
  const pA = plaatsingen.find((p) => p.snijplan_id === 10)!
  const pB = plaatsingen.find((p) => p.snijplan_id === 11)!

  assertEquals(pA.positie_y_cm, 0, 'stuk A op shelf y=0')
  assertEquals(pB.positie_y_cm, 0, 'stuk B op dezelfde shelf (naast-elkaar)')
  assertEquals(pA.positie_x_cm, 0, 'stuk A links')
  assertEquals(pB.positie_x_cm, 200, 'stuk B rechts van A')
})

// ─── Stuk dat niet naast-elkaar past gaat naar een nieuwe shelf ───────────────

Deno.test('stuk dat niet past op bestaande shelf krijgt een nieuwe shelf', () => {
  // Shelf y=0 heeft al 350 cm van de 400 cm benut.
  // Stuk 80×100 past er NIET naast (350+80=430>400).
  // Verwacht: nieuw shelf op y=100 (hoogte van het eerste stuk, h=100).

  // Gebruik packRoll direct om de bezetteMap te simuleren.
  // Eerste stuk 350×100 plaatsen via packRoll, dan het tweede.
  const { placed: existing, remaining } = packRoll(
    [stuk(1, 350, 100)],
    400,
    2000,
  )
  assertEquals(existing[0].positie_y_cm, 0)
  assertEquals(remaining.length, 0)

  // Tweede stuk via packRoll met de shelf al bezet.
  const { placed: tweede } = packRoll(
    [stuk(2, 80, 100)],
    400,
    2000,
    [{ y: 0, height: 100, usedWidth: 350, maxWidth: 400 }],
  )
  assertEquals(tweede.length, 1)
  assertEquals(tweede[0].positie_y_cm, 100, 'stuk 2 krijgt een nieuwe shelf na de eerste')
  assertEquals(tweede[0].positie_x_cm, 0, 'stuk 2 begint links op de nieuwe shelf')
})

// ─── Verhuisd vanuit ffdh-packing.test.ts (audit 2026-07-02) ────────────────
//
// Deze cases dekken orchestratie-gedrag van de lokale test-driver
// `packAcrossRolls` hierboven dat de overige scenario's in dit bestand niet
// raken: bezetteMap-gestuurde rolkeuze, reststuk-verspillingsdrempel,
// express-verdringing tussen rollen, de identieke-afmeting-tiebreaker in
// `tryPlacePiece`, en sortRolls-integratie. Puur-duplicaat cases (een kale
// "twee gelijke stukken op één rol"-sanity zonder bezetteMap) zijn NIET
// meeverhuisd — dat pad wordt al door de bestaande "naast-elkaar"- en
// "twee passende rechthoeken"-tests hierboven gedekt.

Deno.test('packAcrossRolls: nieuw stuk landt in shelf-gap van deels-geplande rol', () => {
  // Scenario Miguel: rol OASI 11 heeft al 240×340 (shelf 1) en 170×170 (shelf 2).
  // Nieuw stuk 100×100 komt binnen — moet in gap van shelf 2 (naast 170×170)
  // landen, NIET op een aparte rol.
  const pieces = [stuk(100, 100, 100, { afleverdatum: '2026-04-24' })]
  const rolls = [
    rol(11, 320, 4620, { status: 'in_snijplan', has_existing_placements: true }),
    rol(1101, 320, 1500),
  ]
  const bezetteMap = new Map<number, Placement[]>([
    [11, [
      plaatsing(1, 0, 0, 240, 340),
      plaatsing(2, 0, 340, 170, 170),
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
  const pieces = [stuk(1, 100, 100)]
  const rolls = [
    rol(1, 320, 500, { status: 'reststuk' }),
    rol(2, 320, 1500),
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
  const pieces = [stuk(1, 100, 100)]
  const rolls = [
    rol(1, 150, 170, { status: 'reststuk' }),
    rol(2, 320, 1500),
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

Deno.test('packAcrossRolls: express stuk verdringt een niet-express stuk van de enige passende rol', () => {
  // Rol heeft precies plek voor 1 stuk van 100×100 (breedte 100, geen ruimte
  // voor een tweede shelf naast elkaar). Het niet-express stuk komt het eerst
  // binnen, maar het express-stuk moet toch de rol krijgen — het niet-express
  // stuk wordt nietGeplaatst (= verdrongen; auto-plan-groep's verdringingscheck
  // vergelijkt dit tegen de oude toewijzing).
  const nietExpress = stuk(1, 100, 100)
  const express = stuk(2, 100, 100, { express: true })
  const rolls = [rol(1, 100, 100)]

  const { rollResults, nietGeplaatst } = packAcrossRolls(
    [nietExpress, express],
    rolls,
    new Map(),
  )

  assertEquals(rollResults.length, 1)
  assertEquals(rollResults[0].plaatsingen.length, 1)
  assertEquals(rollResults[0].plaatsingen[0].snijplan_id, 2, 'express stuk krijgt de rol')
  assertEquals(nietGeplaatst.length, 1)
  assertEquals(nietGeplaatst[0].snijplan_id, 1, 'niet-express stuk is verdrongen')
})

// ─── naastElkaarMogelijk-tiebreaker: twee identieke stukken gaan naast-elkaar ─
// (andere code-tak dan de "twee passende rechthoeken"-tests hierboven: die
// gebruiken verschillend-gedimensioneerde stukken en raken de generieke
// gapIsUseful-tier, dit hier raakt specifiek de heeftZelfdeSoort-boost in
// tryPlacePiece voor STUKKEN VAN IDENTIEKE AFMETING.)

Deno.test('naast-elkaar (identiek): twee 160×230 op een 400cm-brede rol → zelfde Y, x=0 en x=160', () => {
  const pieces = [stuk(1, 160, 230), stuk(2, 160, 230)]
  const rolls = [rol(1, 400, 2000)]
  const { rollResults, nietGeplaatst } = packAcrossRolls(pieces, rolls, new Map())

  assertEquals(nietGeplaatst.length, 0, 'beide stukken moeten geplaatst zijn')
  assertEquals(rollResults.length, 1)
  const plaatsingen = rollResults[0].plaatsingen
  assertEquals(plaatsingen.length, 2)

  assertEquals(
    plaatsingen[0].positie_y_cm,
    plaatsingen[1].positie_y_cm,
    `stukken staan op Y=${plaatsingen[0].positie_y_cm} en Y=${plaatsingen[1].positie_y_cm} — verwacht dezelfde shelf`,
  )
  const xValues = plaatsingen.map(p => p.positie_x_cm).sort((a, b) => a - b)
  assertEquals(xValues[0], 0, 'eerste stuk op x=0')
  assertEquals(xValues[1], 160, 'tweede stuk naast-elkaar op x=160')
  for (const p of plaatsingen) {
    assertEquals(p.lengte_cm, 160, 'stuk is 160cm breed (packer-X), niet geroteerd naar 230cm')
  }
})

Deno.test('naast-elkaar (identiek): drie 160×230 op 400cm — eerste twee naast-elkaar, derde op nieuwe shelf', () => {
  const pieces = [stuk(1, 160, 230), stuk(2, 160, 230), stuk(3, 160, 230)]
  const rolls = [rol(1, 400, 2000)]
  const { rollResults, nietGeplaatst } = packAcrossRolls(pieces, rolls, new Map())

  assertEquals(nietGeplaatst.length, 0)
  const plaatsingen = rollResults[0].plaatsingen
  assertEquals(plaatsingen.length, 3)

  const yValues = plaatsingen.map(p => p.positie_y_cm).sort((a, b) => a - b)
  assertEquals(yValues[0], yValues[1], 'de eerste twee stukken staan op dezelfde shelf (naast-elkaar)')
  assertEquals(yValues[2] > yValues[0], true, 'derde stuk op een eigen lagere shelf')
})

Deno.test('naast-elkaar (identiek): twee 230×160 (omgekeerd) op 400cm → ook naast-elkaar mogelijk', () => {
  const pieces = [stuk(1, 230, 160), stuk(2, 230, 160)]
  const rolls = [rol(1, 400, 2000)]
  const { rollResults, nietGeplaatst } = packAcrossRolls(pieces, rolls, new Map())

  assertEquals(nietGeplaatst.length, 0)
  const plaatsingen = rollResults[0].plaatsingen
  assertEquals(plaatsingen.length, 2)
  assertEquals(
    plaatsingen[0].positie_y_cm,
    plaatsingen[1].positie_y_cm,
    'ook omgekeerd opgegeven → zelfde shelf',
  )
})

Deno.test('sortRolls: rol met bestaande plaatsingen komt eerst', () => {
  const pieces = [stuk(1, 100, 100)]
  const rollA = rol(1, 320, 4620, { status: 'in_snijplan', has_existing_placements: true })
  const rollB = rol(2, 320, 1500)
  // bezetteMap blijft leeg: de test kijkt alleen naar sortering-effect.
  // Als rol A eerst komt, landt het 100×100 daarop.
  const { rollResults } = packAcrossRolls(
    pieces,
    [rollB, rollA], // volgorde omgekeerd in input
    new Map(),
  )
  assertEquals(rollResults[0].rol_id, 1) // rol A ondanks dat hij als tweede binnenkwam
})
