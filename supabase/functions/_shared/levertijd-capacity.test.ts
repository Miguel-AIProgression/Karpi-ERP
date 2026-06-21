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
import { STANDAARD_WERKTIJDEN } from './werkagenda.ts'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function defaultConfig(overrides: Partial<LevertijdConfig> = {}): LevertijdConfig {
  return {
    logistieke_buffer_dagen: 2,
    backlog_minimum_m2: 12,
    capaciteit_per_week_streef: 350,
    capaciteit_per_week_max: 400,
    max_rollen_per_dag_streef: 20,
    capaciteit_marge_pct: 0,
    wisseltijd_minuten: 15,
    maatwerk_weken: 4,
    spoed_buffer_uren: 4,
    spoed_toeslag_bedrag: 50,
    spoed_product_id: 'SPOEDTOESLAG',
    dag_order_snij_buffer_werkdagen: 2,
    werktijden: STANDAARD_WERKTIJDEN,
    ...overrides,
  }
}

// Vlak 5 min/stuk via 'rechthoek' — alle test-rijen zijn rechthoek, dus dit
// reproduceert het oude vlakke snijtijd_minuten-gedrag voor de bestaande
// aantallen-asserties (mig 460: snijtijd is nu per-vorm, zie snijtijd.ts).
const vormTarieven = new Map<string, number>([['rechthoek', 5]])
const moeilijkeKwaliteiten = new Set<string>()

/** Bouw een BezettingsRow met de mig-460-velden, default op rechthoek. */
function rij(id: number, rolId: number | null): BezettingsRow {
  return { id, rol_id: rolId, maatwerk_vorm: 'rechthoek', kwaliteit_code: null }
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
  const result = bezetting([], defaultConfig(), vormTarieven, moeilijkeKwaliteiten)
  assertEquals(result, { stuks: 0, unieke_rollen: 0, minuten: 0 })
})

Deno.test('bezetting: 5 stukken op 2 unieke rollen', () => {
  const rows: BezettingsRow[] = [
    rij(1, 10),
    rij(2, 10),
    rij(3, 11),
    rij(4, 11),
    rij(5, 11),
  ]
  const result = bezetting(rows, defaultConfig(), vormTarieven, moeilijkeKwaliteiten)
  assertEquals(result.stuks, 5)
  assertEquals(result.unieke_rollen, 2)
  // 2 wissels × 15 + 5 stuks × 5 = 55
  assertEquals(result.minuten, 55)
})

Deno.test('bezetting: rol_id null wordt niet geteld als unieke rol', () => {
  const rows: BezettingsRow[] = [
    rij(1, null),
    rij(2, null),
  ]
  const result = bezetting(rows, defaultConfig(), vormTarieven, moeilijkeKwaliteiten)
  assertEquals(result.unieke_rollen, 0)
  assertEquals(result.stuks, 2)
})

Deno.test('bezetting: vorm-tarief weegt zwaarder dan rechthoek', () => {
  const lokaleTarieven = new Map<string, number>([['rechthoek', 5], ['rond', 7.5]])
  const rows: BezettingsRow[] = [
    { id: 1, rol_id: 10, maatwerk_vorm: 'rond', kwaliteit_code: null },
  ]
  const result = bezetting(rows, defaultConfig(), lokaleTarieven, moeilijkeKwaliteiten)
  // 1 wissel × 15 + 1 stuk × 7,5 = 22,5
  assertEquals(result.minuten, 22.5)
})

Deno.test('bezetting: moeilijke kwaliteit telt rechthoek niet als gekort tarief', () => {
  const lokaleTarieven = new Map<string, number>([['rechthoek', 2.5]])
  const lokaleMoeilijk = new Set<string>(['MARI'])
  const rows: BezettingsRow[] = [
    { id: 1, rol_id: 10, maatwerk_vorm: 'rechthoek', kwaliteit_code: 'MARI' },
  ]
  const result = bezetting(rows, defaultConfig(), lokaleTarieven, lokaleMoeilijk)
  // 1 wissel × 15 + 1 stuk × 5 (uitzondering, niet de 2,5 rechthoek-korting) = 20
  assertEquals(result.minuten, 20)
})

// ---------------------------------------------------------------------------
// capaciteitsCheck — week-iteratie
// ---------------------------------------------------------------------------

Deno.test('capaciteitsCheck: ruimte in eerste week → geen iteratie', async () => {
  const cfg = defaultConfig({ capaciteit_per_week_streef: 10, capaciteit_per_week_max: 10 })
  const result = await capaciteitsCheck({
    start_week: 17,
    start_jaar: 2026,
    cfg,
    vormTarieven,
    moeilijkeKwaliteiten,
    fetchBezetting: async () => Array.from({ length: 5 }, (_, i) => rij(i, 1)),
  })
  assertEquals(result.iteraties, 0)
  assertEquals(result.week, 17)
  assertEquals(result.ruimte_stuks, 5)
})

Deno.test('capaciteitsCheck: vol in eerste week → schuift door naar volgende', async () => {
  const cfg = defaultConfig({ capaciteit_per_week_streef: 10, capaciteit_per_week_max: 10 })
  let calls = 0
  const result = await capaciteitsCheck({
    start_week: 17,
    start_jaar: 2026,
    cfg,
    vormTarieven,
    moeilijkeKwaliteiten,
    fetchBezetting: async (week) => {
      calls++
      // Week 17 vol, week 18 leeg
      return week === 17
        ? Array.from({ length: 10 }, (_, i) => rij(i, 1))
        : []
    },
  })
  assertEquals(calls, 2)
  assertEquals(result.week, 18)
  assertEquals(result.iteraties, 1)
  assertEquals(result.ruimte_stuks, 10)
})

Deno.test('capaciteitsCheck: alle weken vol → return laatste met negatieve ruimte', async () => {
  const cfg = defaultConfig({ capaciteit_per_week_streef: 10, capaciteit_per_week_max: 10 })
  const result = await capaciteitsCheck({
    start_week: 17,
    start_jaar: 2026,
    cfg,
    vormTarieven,
    moeilijkeKwaliteiten,
    fetchBezetting: async () => Array.from({ length: 15 }, (_, i) => rij(i, 1)),
  })
  assertEquals(result.iteraties, 6)
  assert(result.ruimte_stuks <= 0)
})

Deno.test('capaciteitsCheck: marge_pct verlaagt max_stuks', async () => {
  const cfg = defaultConfig({ capaciteit_per_week_streef: 100, capaciteit_per_week_max: 100, capaciteit_marge_pct: 20 })
  const result = await capaciteitsCheck({
    start_week: 17,
    start_jaar: 2026,
    cfg,
    vormTarieven,
    moeilijkeKwaliteiten,
    fetchBezetting: async () => [],
  })
  assertEquals(result.max_stuks, 80)
  assertEquals(result.max_stuks_streef, 80)
  assertEquals(result.ruimte_stuks, 80)
})

// ---------------------------------------------------------------------------
// capaciteitsCheck — Fase 3: streef/max-escalatie + rollen-streefwaarde
// ---------------------------------------------------------------------------

Deno.test('capaciteitsCheck: binnen streefwaarde → binnen_streef true, geen escalatie', async () => {
  const cfg = defaultConfig({ capaciteit_per_week_streef: 350, capaciteit_per_week_max: 400 })
  const result = await capaciteitsCheck({
    start_week: 17,
    start_jaar: 2026,
    cfg,
    vormTarieven,
    moeilijkeKwaliteiten,
    fetchBezetting: async () => Array.from({ length: 300 }, (_, i) => rij(i, 1)),
  })
  assertEquals(result.iteraties, 0)
  assertEquals(result.binnen_streef, true)
  assertEquals(result.max_stuks, 400)
  assertEquals(result.max_stuks_streef, 350)
})

Deno.test('capaciteitsCheck: tussen streef en max → automatische escalatie, geen doorschuif', async () => {
  const cfg = defaultConfig({ capaciteit_per_week_streef: 350, capaciteit_per_week_max: 400 })
  let calls = 0
  const result = await capaciteitsCheck({
    start_week: 17,
    start_jaar: 2026,
    cfg,
    vormTarieven,
    moeilijkeKwaliteiten,
    fetchBezetting: async () => {
      calls++
      return Array.from({ length: 370 }, (_, i) => rij(i, 1))
    },
  })
  // Week 17 zelf levert ruimte op (370 < 400) — geen doorschuif naar week 18 nodig,
  // de escalatie naar het maximum gebeurt binnen dezelfde week-iteratie.
  assertEquals(calls, 1)
  assertEquals(result.week, 17)
  assertEquals(result.iteraties, 0)
  assertEquals(result.binnen_streef, false)
  assertEquals(result.ruimte_stuks, 30)
})

Deno.test('capaciteitsCheck: rollen boven streefwaarde blokkeert niet, alleen gerapporteerd', async () => {
  const cfg = defaultConfig({ max_rollen_per_dag_streef: 1 }) // 5 werkdagen × 1 = 5 max_rollen_streef
  const result = await capaciteitsCheck({
    start_week: 17, // maandag 2026-04-20, normale 5-daagse week
    start_jaar: 2026,
    cfg,
    vormTarieven,
    moeilijkeKwaliteiten,
    // 10 stukken op 10 unieke rollen → ruim boven de rollen-streef van 5, maar
    // stuks-capaciteit (350) is niet overschreden → resultaat blokkeert niet.
    fetchBezetting: async () => Array.from({ length: 10 }, (_, i) => rij(i, i)),
  })
  assertEquals(result.iteraties, 0)
  assertEquals(result.huidig_rollen, 10)
  assertEquals(result.max_rollen_streef, 5)
  assertEquals(result.rollen_overschreden, true)
  assert(result.ruimte_stuks > 0, 'rollen-overschrijding blokkeert de capaciteits-ruimte niet')
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
