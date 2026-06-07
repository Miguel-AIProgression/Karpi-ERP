import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  isoWeekJaar,
  isoWeek,
  isoWeekString,
  isoWeekMaandag,
  maandagVanIsoWeek,
} from './iso-week.ts'

const sliceUtc = (d: Date) => d.toISOString().slice(0, 10)

Deno.test('isoWeekJaar: 1 januari 2026 = donderdag → week 1', () => {
  assertEquals(isoWeekJaar(new Date('2026-01-01T12:00:00Z')), { jaar: 2026, week: 1 })
})

Deno.test('isoWeekJaar: 31 december 2024 = dinsdag → week 1 2025', () => {
  assertEquals(isoWeekJaar(new Date('2024-12-31T12:00:00Z')), { jaar: 2025, week: 1 })
})

Deno.test('isoWeekJaar: 20 april 2026 → week 17', () => {
  assertEquals(isoWeekJaar(new Date('2026-04-20T12:00:00Z')), { jaar: 2026, week: 17 })
})

Deno.test('isoWeekJaar: jaargrens week 53 (2026-12-31 do)', () => {
  assertEquals(isoWeekJaar(new Date('2026-12-31T12:00:00Z')), { jaar: 2026, week: 53 })
  assertEquals(isoWeekJaar(new Date('2027-01-01T12:00:00Z')), { jaar: 2026, week: 53 })
  assertEquals(isoWeekJaar(new Date('2027-01-04T12:00:00Z')), { jaar: 2027, week: 1 })
})

Deno.test('isoWeek: enkel weeknummer', () => {
  assertEquals(isoWeek(new Date('2026-05-06T12:00:00Z')), 19)
})

Deno.test('isoWeekString: SQL-pariteit + zero-padding', () => {
  assertEquals(isoWeekString(new Date('2026-01-12T12:00:00Z')), '2026-W03')
  assertEquals(isoWeekString(new Date('2026-05-06T12:00:00Z')), '2026-W19')
  assertEquals(isoWeekString(new Date('2025-12-29T12:00:00Z')), '2026-W01')
})

Deno.test('TZ-robuustheid: 00:00Z en 23:00Z geven hetzelfde weeknummer', () => {
  assertEquals(
    isoWeek(new Date('2026-05-06T00:00:00Z')),
    isoWeek(new Date('2026-05-06T23:00:00Z')),
  )
})

Deno.test('isoWeekMaandag: maandag van week 19/2026 = 2026-05-04', () => {
  assertEquals(sliceUtc(isoWeekMaandag(new Date('2026-05-06T12:00:00Z'))), '2026-05-04')
})

Deno.test('maandagVanIsoWeek: spiegelt levertijd-match maandagVanWeek', () => {
  assertEquals(sliceUtc(maandagVanIsoWeek(2026, 1)), '2025-12-29')
  assertEquals(sliceUtc(maandagVanIsoWeek(2026, 17)), '2026-04-20')
})
