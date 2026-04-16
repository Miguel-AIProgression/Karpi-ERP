// Deno unit tests voor werkagenda.ts

import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import {
  STANDAARD_WERKTIJDEN,
  volgendeWerkminuut,
  plusWerkminuten,
  berekenSnijAgenda,
  type RolAgendaInput,
} from './werkagenda.ts'

// 16 april 2026 = donderdag
const DO_8u = new Date('2026-04-16T08:00:00Z')

Deno.test('volgendeWerkminuut: vóór 08:00 → schuift naar 08:00 zelfde dag', () => {
  const result = volgendeWerkminuut(new Date('2026-04-16T06:30:00Z'), STANDAARD_WERKTIJDEN)
  assertEquals(result.toISOString(), '2026-04-16T08:00:00.000Z')
})

Deno.test('volgendeWerkminuut: in pauze → schuift naar 12:30', () => {
  const result = volgendeWerkminuut(new Date('2026-04-16T12:15:00Z'), STANDAARD_WERKTIJDEN)
  assertEquals(result.toISOString(), '2026-04-16T12:30:00.000Z')
})

Deno.test('volgendeWerkminuut: zaterdag → schuift naar maandag 08:00', () => {
  const result = volgendeWerkminuut(new Date('2026-04-18T10:00:00Z'), STANDAARD_WERKTIJDEN)
  assertEquals(result.toISOString(), '2026-04-20T08:00:00.000Z')
})

Deno.test('volgendeWerkminuut: na 17:00 → volgende werkdag 08:00', () => {
  const result = volgendeWerkminuut(new Date('2026-04-16T17:30:00Z'), STANDAARD_WERKTIJDEN)
  assertEquals(result.toISOString(), '2026-04-17T08:00:00.000Z')
})

Deno.test('plusWerkminuten: +30 min vanaf 08:00 → 08:30', () => {
  const result = plusWerkminuten(DO_8u, 30, STANDAARD_WERKTIJDEN)
  assertEquals(result.toISOString(), '2026-04-16T08:30:00.000Z')
})

Deno.test('plusWerkminuten: +4 uur vanaf 08:00 → 12:00 (vlak vóór pauze)', () => {
  const result = plusWerkminuten(DO_8u, 240, STANDAARD_WERKTIJDEN)
  assertEquals(result.toISOString(), '2026-04-16T12:00:00.000Z')
})

Deno.test('plusWerkminuten: +5 uur vanaf 08:00 → 13:30 (skipt 30 min pauze)', () => {
  const result = plusWerkminuten(DO_8u, 300, STANDAARD_WERKTIJDEN)
  assertEquals(result.toISOString(), '2026-04-16T13:30:00.000Z')
})

Deno.test('plusWerkminuten: +9 uur vanaf 08:00 → volgende werkdag (overschrijdt 17:00 + pauze)', () => {
  // Beschikbare werkminuten dag: 09:00 - 0:30 pauze = 8.5u = 510 min
  const result = plusWerkminuten(DO_8u, 600, STANDAARD_WERKTIJDEN)
  // 510 min op donderdag → resterend 90 min op vrijdag vanaf 08:00 → 09:30
  assertEquals(result.toISOString(), '2026-04-17T09:30:00.000Z')
})

Deno.test('plusWerkminuten: vrijdag eind van dag → maandag', () => {
  // Vrijdag 17 april 16:00 + 120 min: 60 min vrijdag (→17:00) + 60 maandag → 09:00 ma
  const result = plusWerkminuten(new Date('2026-04-17T16:00:00Z'), 120, STANDAARD_WERKTIJDEN)
  assertEquals(result.toISOString(), '2026-04-20T09:00:00.000Z')
})

// ---------------------------------------------------------------------------
// berekenSnijAgenda
// ---------------------------------------------------------------------------

Deno.test('berekenSnijAgenda: 3 rollen op vroegste-leverdatum gesorteerd', () => {
  const rollen: RolAgendaInput[] = [
    { rolId: 1, vroegsteAfleverdatum: '2026-04-25', duurMinuten: 30 },
    { rolId: 2, vroegsteAfleverdatum: '2026-04-20', duurMinuten: 60 },
    { rolId: 3, vroegsteAfleverdatum: '2026-04-22', duurMinuten: 45 },
  ]
  const agenda = berekenSnijAgenda(rollen, STANDAARD_WERKTIJDEN, DO_8u)

  // Volgorde: 2 (20-04), 3 (22-04), 1 (25-04)
  const r2 = agenda.get(2)!
  const r3 = agenda.get(3)!
  const r1 = agenda.get(1)!
  assertEquals(r2.start.toISOString(), '2026-04-16T08:00:00.000Z')
  assertEquals(r2.eind.toISOString(), '2026-04-16T09:00:00.000Z')
  assertEquals(r3.start.toISOString(), '2026-04-16T09:00:00.000Z')
  assertEquals(r1.start.getTime() > r3.eind.getTime() - 1, true)
})

Deno.test('berekenSnijAgenda: rol zonder afleverdatum komt achteraan', () => {
  const rollen: RolAgendaInput[] = [
    { rolId: 1, vroegsteAfleverdatum: null, duurMinuten: 30 },
    { rolId: 2, vroegsteAfleverdatum: '2026-04-20', duurMinuten: 30 },
  ]
  const agenda = berekenSnijAgenda(rollen, STANDAARD_WERKTIJDEN, DO_8u)
  assert(agenda.get(2)!.start.getTime() < agenda.get(1)!.start.getTime())
})

Deno.test('berekenSnijAgenda: hele backlog overspant meerdere dagen', () => {
  // 20 rollen × 30 min = 600 min totaal. 1 dag = 510 min werk → 2 dagen
  const rollen: RolAgendaInput[] = Array.from({ length: 20 }, (_, i) => ({
    rolId: i + 1,
    vroegsteAfleverdatum: '2026-05-01',
    duurMinuten: 30,
  }))
  const agenda = berekenSnijAgenda(rollen, STANDAARD_WERKTIJDEN, DO_8u)
  // Laatste rol moet op vrijdag 17-04 vallen (donderdag werkdag vol = 510min, vrijdag 90 min)
  const laatste = agenda.get(20)!
  assertEquals(laatste.klaarDatum, '2026-04-17')
})

Deno.test('berekenSnijAgenda: lege input → lege map', () => {
  const agenda = berekenSnijAgenda([], STANDAARD_WERKTIJDEN, DO_8u)
  assertEquals(agenda.size, 0)
})
