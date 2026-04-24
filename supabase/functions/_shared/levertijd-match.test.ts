// Deno unit tests voor levertijd-match.ts
// Run: deno test supabase/functions/_shared/levertijd-match.test.ts

import { assertEquals, assert, assertNotEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import {
  reconstructShelves,
  rolHeeftPlek,
  snijDatumVoorRol,
  maandagVanWeek,
  volgendeWerkdag,
  plusKalenderDagen,
  kiesBesteMatch,
  naarWerkdag,
  leverdatumVoorSnijDatum,
} from './levertijd-match.ts'
import type { KandidaatRol, PlanRecord, RolMatchKandidaat } from './levertijd-types.ts'
import type { SnijplanPiece } from './ffdh-packing.ts'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makePiece(overrides: Partial<SnijplanPiece> = {}): SnijplanPiece {
  return {
    id: overrides.id ?? 999,
    lengte_cm: overrides.lengte_cm ?? 100,
    breedte_cm: overrides.breedte_cm ?? 100,
    maatwerk_vorm: overrides.maatwerk_vorm ?? null,
    order_nr: overrides.order_nr ?? null,
    klant_naam: overrides.klant_naam ?? null,
    afleverdatum: overrides.afleverdatum ?? null,
    area_cm2: (overrides.lengte_cm ?? 100) * (overrides.breedte_cm ?? 100),
  }
}

function makePlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: overrides.id ?? 1,
    rol_id: overrides.rol_id ?? 10,
    positie_x_cm: overrides.positie_x_cm ?? 0,
    positie_y_cm: overrides.positie_y_cm ?? 0,
    lengte_cm: overrides.lengte_cm ?? 100,
    breedte_cm: overrides.breedte_cm ?? 100,
    geroteerd: overrides.geroteerd ?? false,
    planning_week: overrides.planning_week ?? null,
    planning_jaar: overrides.planning_jaar ?? null,
    afleverdatum: overrides.afleverdatum ?? null,
    status: overrides.status ?? 'Gepland',
  }
}

function makeRol(overrides: Partial<KandidaatRol> = {}): KandidaatRol {
  return {
    id: overrides.id ?? 10,
    rolnummer: overrides.rolnummer ?? 'R-100',
    lengte_cm: overrides.lengte_cm ?? 3000,   // 30m roll
    breedte_cm: overrides.breedte_cm ?? 400,  // 4m wide
    status: overrides.status ?? 'in_snijplan',
    kwaliteit_code: overrides.kwaliteit_code ?? 'OASI',
    kleur_code: overrides.kleur_code ?? '12',
  }
}

// ---------------------------------------------------------------------------
// reconstructShelves
// ---------------------------------------------------------------------------

Deno.test('reconstructShelves: lege input geeft lege array', () => {
  assertEquals(reconstructShelves([], 400), [])
})

Deno.test('reconstructShelves: één plaatsing → één shelf', () => {
  const shelves = reconstructShelves([
    makePlan({ positie_x_cm: 0, positie_y_cm: 0, lengte_cm: 200, breedte_cm: 150 }),
  ], 400)
  assertEquals(shelves.length, 1)
  assertEquals(shelves[0], { y: 0, height: 150, usedWidth: 200, maxWidth: 400 })
})

Deno.test('reconstructShelves: meerdere stukken op dezelfde shelf-y → cumulatief', () => {
  const shelves = reconstructShelves([
    makePlan({ id: 1, positie_x_cm: 0, positie_y_cm: 0, lengte_cm: 200, breedte_cm: 150 }),
    makePlan({ id: 2, positie_x_cm: 200, positie_y_cm: 0, lengte_cm: 100, breedte_cm: 120 }),
  ], 400)
  assertEquals(shelves.length, 1)
  assertEquals(shelves[0].usedWidth, 300)
  assertEquals(shelves[0].height, 150) // hoogste van de twee
})

Deno.test('reconstructShelves: stukken op verschillende y → meerdere shelves, gesorteerd', () => {
  const shelves = reconstructShelves([
    makePlan({ id: 1, positie_y_cm: 200, lengte_cm: 100, breedte_cm: 80 }),
    makePlan({ id: 2, positie_y_cm: 0, lengte_cm: 100, breedte_cm: 200 }),
  ], 400)
  assertEquals(shelves.length, 2)
  assertEquals(shelves[0].y, 0)
  assertEquals(shelves[1].y, 200)
})

// ---------------------------------------------------------------------------
// rolHeeftPlek
// ---------------------------------------------------------------------------

Deno.test('rolHeeftPlek: lege rol, stuk past → score', () => {
  const rol = makeRol({ lengte_cm: 3000, breedte_cm: 400 })
  const result = rolHeeftPlek(rol, [], makePiece({ lengte_cm: 200, breedte_cm: 300 }))
  assert(result !== null)
  assert(result.waste_score >= 0)
})

Deno.test('rolHeeftPlek: stuk groter dan rol → null', () => {
  const rol = makeRol({ lengte_cm: 100, breedte_cm: 100 })
  const result = rolHeeftPlek(rol, [], makePiece({ lengte_cm: 500, breedte_cm: 500 }))
  assertEquals(result, null)
})

Deno.test('rolHeeftPlek: stuk past in gat naast bestaand stuk', () => {
  const rol = makeRol({ lengte_cm: 3000, breedte_cm: 400 })
  // Bestaand stuk gebruikt 200cm van 400cm breedte op shelf y=0, hoogte 150cm
  const bestaande = [makePlan({ positie_x_cm: 0, positie_y_cm: 0, lengte_cm: 200, breedte_cm: 150 })]
  // Nieuw stuk past in resterende 200cm breedte, hoogte 100cm
  const result = rolHeeftPlek(rol, bestaande, makePiece({ lengte_cm: 150, breedte_cm: 100 }))
  assert(result !== null)
})

Deno.test('rolHeeftPlek: stuk past niet meer naast bestaand → nieuwe shelf', () => {
  const rol = makeRol({ lengte_cm: 3000, breedte_cm: 400 })
  // Shelf vol op y=0 (volledige breedte gebruikt)
  const bestaande = [makePlan({ positie_x_cm: 0, positie_y_cm: 0, lengte_cm: 400, breedte_cm: 200 })]
  // Nieuw stuk komt op nieuwe shelf y=200
  const result = rolHeeftPlek(rol, bestaande, makePiece({ lengte_cm: 300, breedte_cm: 100 }))
  assert(result !== null)
})

Deno.test('rolHeeftPlek: rol vol → null', () => {
  const rol = makeRol({ lengte_cm: 100, breedte_cm: 400 })
  const bestaande = [makePlan({ positie_x_cm: 0, positie_y_cm: 0, lengte_cm: 400, breedte_cm: 100 })]
  const result = rolHeeftPlek(rol, bestaande, makePiece({ lengte_cm: 100, breedte_cm: 100 }))
  assertEquals(result, null)
})

// ---------------------------------------------------------------------------
// Datum-helpers
// ---------------------------------------------------------------------------

Deno.test('maandagVanWeek: week 1 2026 = 29-12-2025 (ISO week)', () => {
  // ISO 2026-W01 begint op maandag 29 december 2025
  assertEquals(maandagVanWeek(1, 2026), '2025-12-29')
})

Deno.test('maandagVanWeek: week 17 2026', () => {
  // Maandag van ISO 2026-W17 = 20 april 2026
  assertEquals(maandagVanWeek(17, 2026), '2026-04-20')
})

Deno.test('plusKalenderDagen: +2 dagen', () => {
  assertEquals(plusKalenderDagen('2026-04-20', 2), '2026-04-22')
})

Deno.test('plusKalenderDagen: maand-overgang', () => {
  assertEquals(plusKalenderDagen('2026-04-30', 3), '2026-05-03')
})

Deno.test('naarWerkdag: werkdag blijft', () => {
  assertEquals(naarWerkdag('2026-04-23'), '2026-04-23')  // donderdag
})

Deno.test('naarWerkdag: zaterdag → maandag', () => {
  assertEquals(naarWerkdag('2026-04-25'), '2026-04-27')
})

Deno.test('naarWerkdag: zondag → maandag', () => {
  assertEquals(naarWerkdag('2026-04-26'), '2026-04-27')
})

Deno.test('leverdatumVoorSnijDatum: snij donderdag 23 + 2 = zaterdag → maandag 27', () => {
  assertEquals(leverdatumVoorSnijDatum('2026-04-23', 2), '2026-04-27')
})

Deno.test('leverdatumVoorSnijDatum: snij maandag 20 + 2 = woensdag 22 (blijft werkdag)', () => {
  assertEquals(leverdatumVoorSnijDatum('2026-04-20', 2), '2026-04-22')
})

Deno.test('volgendeWerkdag: vrijdag → maandag', () => {
  // 17 april 2026 is een vrijdag
  assertEquals(volgendeWerkdag(new Date('2026-04-17T12:00:00Z')), '2026-04-20')
})

Deno.test('volgendeWerkdag: zaterdag → maandag', () => {
  assertEquals(volgendeWerkdag(new Date('2026-04-18T12:00:00Z')), '2026-04-20')
})

// ---------------------------------------------------------------------------
// snijDatumVoorRol
// ---------------------------------------------------------------------------

Deno.test('snijDatumVoorRol: afleverdatum wint, snij = afleverdatum − buffer', () => {
  // Twee plaatsingen, vroegste afleverdatum = 29-04-2026, buffer = 2 dagen → snij = 27-04.
  // vandaag < berekend dus floor activeert niet.
  const vandaag = new Date('2026-04-15T12:00:00Z')
  const datum = snijDatumVoorRol([
    makePlan({ afleverdatum: '2026-05-04' }),
    makePlan({ afleverdatum: '2026-04-29' }),
  ], 2, vandaag)
  assertEquals(datum, '2026-04-27')
})

Deno.test('snijDatumVoorRol: afleverdatum in verleden (backlog) → floor op volgende werkdag', () => {
  // Scenario: rol staat op Gepland maar bevat een order die al overtijd is.
  // Zonder floor zou snij_datum = 2026-04-03 worden → leverdatum in het verleden.
  const vandaag = new Date('2026-04-22T12:00:00Z') // woensdag
  const datum = snijDatumVoorRol([
    makePlan({ afleverdatum: '2026-04-05' }),
  ], 2, vandaag)
  assertEquals(datum, '2026-04-23') // eerstvolgende werkdag (donderdag)
})

Deno.test('snijDatumVoorRol: zonder afleverdatum → vroegste planning_week wint', () => {
  // planning_week 16, 17, 18 in 2026 → maandag week 16 = 13-04-2026.
  // vandaag voor week 16 zodat floor niet activeert.
  const vandaag = new Date('2026-04-10T12:00:00Z')
  const datum = snijDatumVoorRol([
    makePlan({ planning_week: 18, planning_jaar: 2026 }),
    makePlan({ planning_week: 16, planning_jaar: 2026 }),
    makePlan({ planning_week: 17, planning_jaar: 2026 }),
  ], 2, vandaag)
  assertEquals(datum, maandagVanWeek(16, 2026))
})

Deno.test('snijDatumVoorRol: planning_week in verleden → floor op volgende werkdag', () => {
  const vandaag = new Date('2026-04-22T12:00:00Z') // week 17
  const datum = snijDatumVoorRol([
    makePlan({ planning_week: 14, planning_jaar: 2026 }),
  ], 2, vandaag)
  assertEquals(datum, '2026-04-23')
})

Deno.test('snijDatumVoorRol: geen planning + geen afleverdatum → volgende werkdag', () => {
  const vandaag = new Date('2026-04-15T12:00:00Z')  // woensdag
  const datum = snijDatumVoorRol([makePlan({ planning_week: null, planning_jaar: null })], 2, vandaag)
  assertEquals(datum, '2026-04-16')
})

// ---------------------------------------------------------------------------
// kiesBesteMatch
// ---------------------------------------------------------------------------

Deno.test('kiesBesteMatch: lege kandidaten → niet gevonden', () => {
  const result = kiesBesteMatch({ kandidaten: [], logistieke_buffer_dagen: 2 })
  assertEquals(result, { gevonden: false, reden: 'geen_plek_op_bestaande_rollen' })
})

Deno.test('kiesBesteMatch: vroegste snij-datum wint', () => {
  const kandidaten: RolMatchKandidaat[] = [
    { rol: makeRol({ id: 1, rolnummer: 'R-1' }), snij_datum: '2026-04-27', is_exact: true, waste_score: 50 },
    { rol: makeRol({ id: 2, rolnummer: 'R-2' }), snij_datum: '2026-04-20', is_exact: false, waste_score: 100 },
  ]
  const result = kiesBesteMatch({ kandidaten, logistieke_buffer_dagen: 2 })
  assert(result.gevonden)
  assertEquals(result.rol_id, 2)
  assertEquals(result.snij_datum, '2026-04-20')
  assertEquals(result.lever_datum, '2026-04-22')
  assertEquals(result.kwaliteit_match, 'uitwisselbaar')
})

Deno.test('kiesBesteMatch: zelfde datum → exact match wint', () => {
  const kandidaten: RolMatchKandidaat[] = [
    { rol: makeRol({ id: 1 }), snij_datum: '2026-04-20', is_exact: false, waste_score: 50 },
    { rol: makeRol({ id: 2 }), snij_datum: '2026-04-20', is_exact: true, waste_score: 100 },
  ]
  const result = kiesBesteMatch({ kandidaten, logistieke_buffer_dagen: 2 })
  assert(result.gevonden)
  assertEquals(result.rol_id, 2)
  assertEquals(result.kwaliteit_match, 'exact')
})

Deno.test('kiesBesteMatch: zelfde datum + exact → laagste waste wint', () => {
  const kandidaten: RolMatchKandidaat[] = [
    { rol: makeRol({ id: 1 }), snij_datum: '2026-04-20', is_exact: true, waste_score: 100 },
    { rol: makeRol({ id: 2 }), snij_datum: '2026-04-20', is_exact: true, waste_score: 30 },
  ]
  const result = kiesBesteMatch({ kandidaten, logistieke_buffer_dagen: 2 })
  assert(result.gevonden)
  assertEquals(result.rol_id, 2)
})

Deno.test('kiesBesteMatch: lever_datum past buffer toe', () => {
  const kandidaten: RolMatchKandidaat[] = [
    { rol: makeRol({ id: 1 }), snij_datum: '2026-04-20', is_exact: true, waste_score: 0 },
  ]
  const result = kiesBesteMatch({ kandidaten, logistieke_buffer_dagen: 5 })
  assert(result.gevonden)
  // 20-04 (ma) + 5 = 25-04 (za) → naarWerkdag → 27-04 (ma)
  assertEquals(result.lever_datum, '2026-04-27')
})
