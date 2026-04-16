// Deno unit tests voor levertijd-resolver.ts

import { assertEquals, assert, assertStringIncludes } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { resolveScenario, isSpoed } from './levertijd-resolver.ts'
import type {
  BacklogResult,
  CapaciteitsCheckResult,
  LevertijdConfig,
  MatchResult,
} from './levertijd-types.ts'

const VANDAAG = new Date('2026-04-15T12:00:00Z')

function defaultConfig(overrides: Partial<LevertijdConfig> = {}): LevertijdConfig {
  return {
    logistieke_buffer_dagen: 2,
    backlog_minimum_m2: 12,
    capaciteit_per_week: 450,
    capaciteit_marge_pct: 0,
    wisseltijd_minuten: 15,
    snijtijd_minuten: 5,
    maatwerk_weken: 4,
    ...overrides,
  }
}

const matchGevonden: MatchResult = {
  gevonden: true,
  rol_id: 99,
  rolnummer: 'R-12345',
  snij_datum: '2026-04-20',
  lever_datum: '2026-04-22',
  kwaliteit_match: 'exact',
}

const matchNietGevonden: MatchResult = {
  gevonden: false,
  reden: 'geen_plek_op_bestaande_rollen',
}

const capaciteitOk: CapaciteitsCheckResult = {
  week: 17,
  jaar: 2026,
  huidig_stuks: 100,
  max_stuks: 450,
  ruimte_stuks: 350,
  iteraties: 0,
}

const backlogOk: BacklogResult = { totaal_m2: 20, aantal_stukken: 8, voldoende: true }
const backlogLeeg: BacklogResult = { totaal_m2: 2, aantal_stukken: 1, voldoende: false }

// ---------------------------------------------------------------------------
// isSpoed
// ---------------------------------------------------------------------------

Deno.test('isSpoed: gewenste datum binnen 2 dagen → true', () => {
  assertEquals(isSpoed('2026-04-16', VANDAAG), true)
})

Deno.test('isSpoed: gewenste datum > 2 dagen → false', () => {
  assertEquals(isSpoed('2026-04-30', VANDAAG), false)
})

Deno.test('isSpoed: null → false', () => {
  assertEquals(isSpoed(null, VANDAAG), false)
})

Deno.test('isSpoed: in verleden → true', () => {
  assertEquals(isSpoed('2026-04-10', VANDAAG), true)
})

// ---------------------------------------------------------------------------
// resolveScenario — match scenario
// ---------------------------------------------------------------------------

Deno.test('resolveScenario: match gevonden → match_bestaande_rol', () => {
  const result = resolveScenario({
    match: matchGevonden,
    capaciteit: capaciteitOk,
    backlog: backlogOk,
    cfg: defaultConfig(),
    nieuw_stuk_m2: 6,
    vandaag: VANDAAG,
  })
  assertEquals(result.scenario, 'match_bestaande_rol')
  assertEquals(result.lever_datum, '2026-04-22')
  assertEquals(result.details.match_rol?.rolnummer, 'R-12345')
  assertStringIncludes(result.onderbouwing, 'R-12345')
  assertStringIncludes(result.onderbouwing, 'snij-week 17')
})

Deno.test('resolveScenario: match + uitwisselbaar → onderbouwing vermeldt dit', () => {
  const result = resolveScenario({
    match: { ...matchGevonden, kwaliteit_match: 'uitwisselbaar' },
    capaciteit: capaciteitOk,
    backlog: backlogOk,
    cfg: defaultConfig(),
    nieuw_stuk_m2: 6,
    vandaag: VANDAAG,
  })
  assertStringIncludes(result.onderbouwing, 'uitwisselbare')
})

// ---------------------------------------------------------------------------
// resolveScenario — nieuwe rol scenario
// ---------------------------------------------------------------------------

Deno.test('resolveScenario: geen match + cap OK + backlog OK → nieuwe_rol_gepland', () => {
  const result = resolveScenario({
    match: matchNietGevonden,
    capaciteit: capaciteitOk,
    backlog: backlogOk,
    cfg: defaultConfig(),
    nieuw_stuk_m2: 6,
    vandaag: VANDAAG,
  })
  assertEquals(result.scenario, 'nieuwe_rol_gepland')
  // snij-week 17 maandag = 20-04, +4 = vrijdag 24-04, +2 buffer = 26-04 (zo) → naarWerkdag → 27-04 (ma)
  assertEquals(result.lever_datum, '2026-04-27')
  assertStringIncludes(result.onderbouwing, 'week 17')
  assert(result.details.capaciteit !== undefined)
})

Deno.test('resolveScenario: capaciteits-iteratie wordt gemeld', () => {
  const result = resolveScenario({
    match: matchNietGevonden,
    capaciteit: { ...capaciteitOk, iteraties: 2, week: 19 },
    backlog: backlogOk,
    cfg: defaultConfig(),
    nieuw_stuk_m2: 6,
    vandaag: VANDAAG,
  })
  assertStringIncludes(result.onderbouwing, 'doorgeschoven')
})

// ---------------------------------------------------------------------------
// resolveScenario — wacht op orders scenario
// ---------------------------------------------------------------------------

Deno.test('resolveScenario: geen match + lage backlog → wacht_op_orders', () => {
  const result = resolveScenario({
    match: matchNietGevonden,
    capaciteit: capaciteitOk,
    backlog: backlogLeeg,
    cfg: defaultConfig(),
    nieuw_stuk_m2: 6,
    vandaag: VANDAAG,
  })
  assertEquals(result.scenario, 'wacht_op_orders')
  assertEquals(result.lever_datum, null)
  assert(result.vroegst_mogelijk !== undefined)
  assertStringIncludes(result.onderbouwing, 'backlog')
  assertStringIncludes(result.onderbouwing, 'drempel')
})

Deno.test('resolveScenario: geen passende rol in voorraad → wacht_op_orders met inkoop-uitleg', () => {
  const result = resolveScenario({
    match: matchNietGevonden,
    capaciteit: capaciteitOk,
    backlog: backlogOk,
    cfg: defaultConfig(),
    nieuw_stuk_m2: 6,
    vandaag: VANDAAG,
    geen_rol_passend: true,
  })
  assertEquals(result.scenario, 'wacht_op_orders')
  assertStringIncludes(result.onderbouwing, 'inkoop')
})

// ---------------------------------------------------------------------------
// resolveScenario — spoed scenario
// ---------------------------------------------------------------------------

Deno.test('resolveScenario: gewenste datum < 2 dagen + datum niet haalbaar → spoed', () => {
  const result = resolveScenario({
    match: matchNietGevonden,
    capaciteit: capaciteitOk,
    backlog: backlogOk,
    cfg: defaultConfig(),
    nieuw_stuk_m2: 6,
    gewenste_leverdatum: '2026-04-16',  // 1 dag van VANDAAG (15-04)
    vandaag: VANDAAG,
  })
  assertEquals(result.scenario, 'spoed')
})

Deno.test('resolveScenario: spoed + match wel haalbaar → match (geen spoed)', () => {
  // Match levert 22-04, gewenst is 30-04 → niet spoed
  const result = resolveScenario({
    match: matchGevonden,
    capaciteit: capaciteitOk,
    backlog: backlogOk,
    cfg: defaultConfig(),
    nieuw_stuk_m2: 6,
    gewenste_leverdatum: '2026-04-30',
    vandaag: VANDAAG,
  })
  assertEquals(result.scenario, 'match_bestaande_rol')
})

// ---------------------------------------------------------------------------
// Onderbouwing-lengte
// ---------------------------------------------------------------------------

Deno.test('resolveScenario: onderbouwing max 240 chars', () => {
  const result = resolveScenario({
    match: matchGevonden,
    capaciteit: capaciteitOk,
    backlog: backlogOk,
    cfg: defaultConfig(),
    nieuw_stuk_m2: 6,
    vandaag: VANDAAG,
  })
  assert(result.onderbouwing.length <= 240)
})
