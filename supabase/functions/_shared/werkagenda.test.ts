// Deno unit tests voor werkagenda.ts — TZ-agnostisch: datums via de lokale
// constructor, asserts via de lokale klok. Groen op de dev-machine
// (Europe/Amsterdam) én in CI/edge (UTC).
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import {
  STANDAARD_WERKTIJDEN,
  volgendeWerkminuut,
  plusWerkminuten,
  berekenSnijAgenda,
  isoDatum,
  type RolAgendaInput,
} from './werkagenda.ts'

const lokaal = (j: number, m: number, d: number, u = 0, min = 0) => new Date(j, m - 1, d, u, min)
const klok = (d: Date) =>
  `${isoDatum(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

// 16 april 2026 = donderdag
const DO_8u = lokaal(2026, 4, 16, 8, 0)

Deno.test('volgendeWerkminuut: vóór 08:00 → schuift naar 08:00 zelfde dag', () => {
  assertEquals(klok(volgendeWerkminuut(lokaal(2026, 4, 16, 6, 30), STANDAARD_WERKTIJDEN)), '2026-04-16 08:00')
})

Deno.test('volgendeWerkminuut: in pauze → schuift naar 12:30', () => {
  assertEquals(klok(volgendeWerkminuut(lokaal(2026, 4, 16, 12, 15), STANDAARD_WERKTIJDEN)), '2026-04-16 12:30')
})

Deno.test('volgendeWerkminuut: zaterdag → schuift naar maandag 08:00', () => {
  assertEquals(klok(volgendeWerkminuut(lokaal(2026, 4, 18, 10, 0), STANDAARD_WERKTIJDEN)), '2026-04-20 08:00')
})

Deno.test('volgendeWerkminuut: na 17:00 → volgende werkdag 08:00', () => {
  assertEquals(klok(volgendeWerkminuut(lokaal(2026, 4, 16, 17, 30), STANDAARD_WERKTIJDEN)), '2026-04-17 08:00')
})

Deno.test('volgendeWerkminuut: vrije dag → schuift naar volgende werkdag', () => {
  const w = { ...STANDAARD_WERKTIJDEN, vrij: [{ datum: '2026-04-16', naam: 'testvrij' }] }
  assertEquals(klok(volgendeWerkminuut(lokaal(2026, 4, 16, 10, 0), w)), '2026-04-17 08:00')
})

Deno.test('plusWerkminuten: +30 min vanaf 08:00 → 08:30', () => {
  assertEquals(klok(plusWerkminuten(DO_8u, 30, STANDAARD_WERKTIJDEN)), '2026-04-16 08:30')
})

Deno.test('plusWerkminuten: +4 uur vanaf 08:00 → 12:00 (vlak vóór pauze)', () => {
  assertEquals(klok(plusWerkminuten(DO_8u, 240, STANDAARD_WERKTIJDEN)), '2026-04-16 12:00')
})

Deno.test('plusWerkminuten: +5 uur vanaf 08:00 → 13:30 (skipt 30 min pauze)', () => {
  assertEquals(klok(plusWerkminuten(DO_8u, 300, STANDAARD_WERKTIJDEN)), '2026-04-16 13:30')
})

Deno.test('plusWerkminuten: +9 uur vanaf 08:00 → volgende werkdag (overschrijdt 17:00 + pauze)', () => {
  // Beschikbare werkminuten per dag: 09:00 − 0:30 pauze = 510 min
  // 510 op donderdag → resterend 90 min op vrijdag vanaf 08:00 → 09:30
  assertEquals(klok(plusWerkminuten(DO_8u, 600, STANDAARD_WERKTIJDEN)), '2026-04-17 09:30')
})

Deno.test('plusWerkminuten: vrijdag eind van dag → maandag', () => {
  // Vrijdag 17 april 16:00 + 120 min: 60 vrijdag (→17:00) + 60 maandag → ma 09:00
  assertEquals(klok(plusWerkminuten(lokaal(2026, 4, 17, 16, 0), 120, STANDAARD_WERKTIJDEN)), '2026-04-20 09:00')
})

Deno.test('plusWerkminuten: vrije vrijdag → werk schuift naar maandag', () => {
  const w = { ...STANDAARD_WERKTIJDEN, vrij: [{ datum: '2026-04-17' }] }
  // Donderdag 16:00 + 120 min: 60 do (→17:00), vr is vrij → 60 ma → ma 09:00
  assertEquals(klok(plusWerkminuten(lokaal(2026, 4, 16, 16, 0), 120, w)), '2026-04-20 09:00')
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
  const r2 = agenda.get(2)!
  const r3 = agenda.get(3)!
  const r1 = agenda.get(1)!
  assertEquals(klok(r2.start), '2026-04-16 08:00')
  assertEquals(klok(r2.eind), '2026-04-16 09:00')
  assertEquals(klok(r3.start), '2026-04-16 09:00')
  assert(r1.start.getTime() > r3.eind.getTime() - 1)
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
  // 20 rollen × 30 min = 600 min; 1 dag = 510 min → laatste rol klaar op vrijdag
  const rollen: RolAgendaInput[] = Array.from({ length: 20 }, (_, i) => ({
    rolId: i + 1,
    vroegsteAfleverdatum: '2026-05-01',
    duurMinuten: 30,
  }))
  const agenda = berekenSnijAgenda(rollen, STANDAARD_WERKTIJDEN, DO_8u)
  assertEquals(agenda.get(20)!.klaarDatum, '2026-04-17')
})

Deno.test('berekenSnijAgenda: teLaat strikt — eind op (lever − buffer) zelf is te laat', () => {
  // Lever ma 20-04, buffer 2 → deadline za 18-04 00:00. Snij-eind do 16-04 09:00 < deadline → op tijd.
  const opTijd = berekenSnijAgenda(
    [{ rolId: 1, vroegsteAfleverdatum: '2026-04-20', duurMinuten: 60 }],
    STANDAARD_WERKTIJDEN, DO_8u,
  )
  assertEquals(opTijd.get(1)!.teLaat, false)
  // Lever vr 17-04, buffer 2 → deadline wo 15-04 00:00. Snij-eind do 16-04 → te laat.
  const teLaat = berekenSnijAgenda(
    [{ rolId: 1, vroegsteAfleverdatum: '2026-04-17', duurMinuten: 60 }],
    STANDAARD_WERKTIJDEN, DO_8u,
  )
  assertEquals(teLaat.get(1)!.teLaat, true)
})

Deno.test('berekenSnijAgenda: lege input → lege map', () => {
  assertEquals(berekenSnijAgenda([], STANDAARD_WERKTIJDEN, DO_8u).size, 0)
})
