// Deno unit tests voor levertijd-capacity.ts

import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import {
  bezetting,
  capaciteitsCheck,
  isoWeekJaar,
  snijWeekVoorLever,
  nextWeek,
  backlogIsVoldoende,
} from './levertijd-capacity.ts'
import type { BezettingsRow, LevertijdConfig } from './levertijd-types.ts'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// isoWeekJaar
// ---------------------------------------------------------------------------

Deno.test('isoWeekJaar: 1 januari 2026 = donderdag → week 1', () => {
  assertEquals(isoWeekJaar(new Date('2026-01-01T12:00:00Z')), { week: 1, jaar: 2026 })
})

Deno.test('isoWeekJaar: 31 december 2024 = dinsdag → week 1 2025', () => {
  assertEquals(isoWeekJaar(new Date('2024-12-31T12:00:00Z')), { week: 1, jaar: 2025 })
})

Deno.test('isoWeekJaar: 20 april 2026 → week 17', () => {
  assertEquals(isoWeekJaar(new Date('2026-04-20T12:00:00Z')), { week: 17, jaar: 2026 })
})

// ---------------------------------------------------------------------------
// snijWeekVoorLever
// ---------------------------------------------------------------------------

Deno.test('snijWeekVoorLever: leverdatum week 17 → snij-week 16', () => {
  // 22 april 2026 zit in week 17
  const result = snijWeekVoorLever('2026-04-22')
  assertEquals(result.week, 16)
  assertEquals(result.jaar, 2026)
  assertEquals(result.maandag, '2026-04-13')
})

Deno.test('snijWeekVoorLever: leverdatum begin januari rolt jaargrens correct', () => {
  // 1 januari 2025 valt in ISO-week 1 van 2025; min 7 dagen = 25-12-2024 = ISO-week 52 2024
  const result = snijWeekVoorLever('2025-01-01')
  assertEquals(result.jaar, 2024)
  assertEquals(result.week, 52)
})

// ---------------------------------------------------------------------------
// nextWeek
// ---------------------------------------------------------------------------

Deno.test('nextWeek: week 16 2026 → week 17 2026', () => {
  assertEquals(nextWeek(16, 2026), { week: 17, jaar: 2026 })
})

Deno.test('nextWeek: laatste ISO-week → eerste van volgend jaar', () => {
  // 2024 heeft 52 ISO-weken; week 52 → week 1 2025
  assertEquals(nextWeek(52, 2024), { week: 1, jaar: 2025 })
})

// ---------------------------------------------------------------------------
// bezetting
// ---------------------------------------------------------------------------

Deno.test('bezetting: lege input → 0', () => {
  const result = bezetting([], defaultConfig())
  assertEquals(result, { stuks: 0, unieke_rollen: 0, minuten: 0 })
})

Deno.test('bezetting: 5 stukken op 2 unieke rollen', () => {
  const rows: BezettingsRow[] = [
    { id: 1, rol_id: 10 },
    { id: 2, rol_id: 10 },
    { id: 3, rol_id: 11 },
    { id: 4, rol_id: 11 },
    { id: 5, rol_id: 11 },
  ]
  const result = bezetting(rows, defaultConfig())
  assertEquals(result.stuks, 5)
  assertEquals(result.unieke_rollen, 2)
  // 2 wissels × 15 + 5 stuks × 5 = 55
  assertEquals(result.minuten, 55)
})

Deno.test('bezetting: rol_id null wordt niet geteld als unieke rol', () => {
  const rows: BezettingsRow[] = [
    { id: 1, rol_id: null },
    { id: 2, rol_id: null },
  ]
  const result = bezetting(rows, defaultConfig())
  assertEquals(result.unieke_rollen, 0)
  assertEquals(result.stuks, 2)
})

// ---------------------------------------------------------------------------
// capaciteitsCheck — week-iteratie
// ---------------------------------------------------------------------------

Deno.test('capaciteitsCheck: ruimte in eerste week → geen iteratie', async () => {
  const cfg = defaultConfig({ capaciteit_per_week: 10 })
  const result = await capaciteitsCheck({
    start_week: 17,
    start_jaar: 2026,
    cfg,
    fetchBezetting: async () => Array.from({ length: 5 }, (_, i) => ({ id: i, rol_id: 1 })),
  })
  assertEquals(result.iteraties, 0)
  assertEquals(result.week, 17)
  assertEquals(result.ruimte_stuks, 5)
})

Deno.test('capaciteitsCheck: vol in eerste week → schuift door naar volgende', async () => {
  const cfg = defaultConfig({ capaciteit_per_week: 10 })
  let calls = 0
  const result = await capaciteitsCheck({
    start_week: 17,
    start_jaar: 2026,
    cfg,
    fetchBezetting: async (week) => {
      calls++
      // Week 17 vol, week 18 leeg
      return week === 17
        ? Array.from({ length: 10 }, (_, i) => ({ id: i, rol_id: 1 }))
        : []
    },
  })
  assertEquals(calls, 2)
  assertEquals(result.week, 18)
  assertEquals(result.iteraties, 1)
  assertEquals(result.ruimte_stuks, 10)
})

Deno.test('capaciteitsCheck: alle weken vol → return laatste met negatieve ruimte', async () => {
  const cfg = defaultConfig({ capaciteit_per_week: 10 })
  const result = await capaciteitsCheck({
    start_week: 17,
    start_jaar: 2026,
    cfg,
    fetchBezetting: async () => Array.from({ length: 15 }, (_, i) => ({ id: i, rol_id: 1 })),
  })
  assertEquals(result.iteraties, 6)
  assert(result.ruimte_stuks <= 0)
})

Deno.test('capaciteitsCheck: marge_pct verlaagt max_stuks', async () => {
  const cfg = defaultConfig({ capaciteit_per_week: 100, capaciteit_marge_pct: 20 })
  const result = await capaciteitsCheck({
    start_week: 17,
    start_jaar: 2026,
    cfg,
    fetchBezetting: async () => [],
  })
  assertEquals(result.max_stuks, 80)
  assertEquals(result.ruimte_stuks, 80)
})

// ---------------------------------------------------------------------------
// backlogIsVoldoende
// ---------------------------------------------------------------------------

Deno.test('backlogIsVoldoende: backlog + nieuw stuk ≥ drempel → true', () => {
  const result = backlogIsVoldoende({ totaal_m2: 8, aantal_stukken: 3 }, 5, 12)
  assertEquals(result.voldoende, true)
  assertEquals(result.totaal_m2, 8)
})

Deno.test('backlogIsVoldoende: te weinig backlog → false', () => {
  const result = backlogIsVoldoende({ totaal_m2: 4, aantal_stukken: 1 }, 2, 12)
  assertEquals(result.voldoende, false)
})

Deno.test('backlogIsVoldoende: precies op drempel → true', () => {
  const result = backlogIsVoldoende({ totaal_m2: 7, aantal_stukken: 2 }, 5, 12)
  assertEquals(result.voldoende, true)
})
