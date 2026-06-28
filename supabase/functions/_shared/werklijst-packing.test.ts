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
  packAcrossRolls,
  packRoll,
  sortPieces,
  type Roll,
  type SnijplanPiece,
} from './ffdh-packing.ts'

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

function rol(id: number, breedte_cm: number, lengte_cm: number): Roll {
  return {
    id,
    rolnummer: `R${id}`,
    lengte_cm,
    breedte_cm,
    status: 'beschikbaar',
    oppervlak_m2: (lengte_cm * breedte_cm) / 10000,
    sort_priority: 2,
    is_exact: true,
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
