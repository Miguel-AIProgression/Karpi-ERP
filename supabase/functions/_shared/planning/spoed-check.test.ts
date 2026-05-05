// Deno unit tests voor spoed-check.ts

import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { evalueerSpoed } from './spoed-check.ts'
import type { LevertijdConfig } from './levertijd-types.ts'
import type { RolAgendaSlot } from './werkagenda.ts'

function defaultConfig(overrides: Partial<LevertijdConfig> = {}): LevertijdConfig {
  return {
    logistieke_buffer_dagen: 2, backlog_minimum_m2: 12, capaciteit_per_week: 450,
    capaciteit_marge_pct: 0, wisseltijd_minuten: 15, snijtijd_minuten: 5,
    maatwerk_weken: 4, spoed_buffer_uren: 4, spoed_toeslag_bedrag: 50,
    spoed_product_id: 'SPOEDTOESLAG',
    ...overrides,
  }
}

// 16 april 2026 = donderdag, ISO-week 16
const VANDAAG = new Date('2026-04-16T08:00:00Z')

Deno.test('evalueerSpoed: lege werkagenda → spoed deze week beschikbaar', () => {
  const result = evalueerSpoed(new Map(), 30, defaultConfig(), VANDAAG)
  assertEquals(result.beschikbaar, true)
  assertEquals(result.scenario, 'spoed_deze_week')
  assert(result.snij_datum !== null)
})

Deno.test('evalueerSpoed: backlog vult deze week vol → spoed volgende week', () => {
  // Backlog overspant ma 13 t/m vr 17 apr (volledig deze week beslagen)
  const fakeAgenda = new Map<number, RolAgendaSlot>()
  fakeAgenda.set(1, {
    start: new Date('2026-04-13T08:00:00Z'),
    eind: new Date('2026-04-17T17:00:00Z'),
    klaarDatum: '2026-04-17',
    teLaat: false,
  })
  const result = evalueerSpoed(fakeAgenda, 30, defaultConfig(), VANDAAG)
  assertEquals(result.scenario, 'spoed_volgende_week')
  assert(result.snij_datum !== null)
})

Deno.test('evalueerSpoed: backlog tot ma+di volgende week → past nog (4u buffer ok)', () => {
  // Volledig deze week + ma+di volgende week beslagen
  const fakeAgenda = new Map<number, RolAgendaSlot>()
  fakeAgenda.set(1, {
    start: new Date('2026-04-13T08:00:00Z'),
    eind: new Date('2026-04-21T17:00:00Z'),  // di einde van werkdag
    klaarDatum: '2026-04-21',
    teLaat: false,
  })
  const result = evalueerSpoed(fakeAgenda, 30, defaultConfig({ spoed_buffer_uren: 4 }), VANDAAG)
  // Volgende week heeft nog wo+do+vr beschikbaar (3 × 8.5u = 25.5u) - 4u buffer = 21.5u → past
  assertEquals(result.beschikbaar, true)
  assertEquals(result.scenario, 'spoed_volgende_week')
})

Deno.test('evalueerSpoed: beide weken vol → niet beschikbaar', () => {
  const fakeAgenda = new Map<number, RolAgendaSlot>()
  fakeAgenda.set(1, {
    start: new Date('2026-04-13T08:00:00Z'),
    eind: new Date('2026-04-24T17:00:00Z'),  // hele 2 weken beslagen
    klaarDatum: '2026-04-24',
    teLaat: false,
  })
  const result = evalueerSpoed(fakeAgenda, 30, defaultConfig(), VANDAAG)
  assertEquals(result.beschikbaar, false)
  assertEquals(result.scenario, 'spoed_geen_plek')
})

Deno.test('evalueerSpoed: nieuwStuk groter dan week-restruimte → schuift door', () => {
  const fakeAgenda = new Map<number, RolAgendaSlot>()
  fakeAgenda.set(1, {
    start: new Date('2026-04-13T08:00:00Z'),
    eind: new Date('2026-04-17T15:00:00Z'),  // bijna vol (~2u over - 4u buffer = -2u)
    klaarDatum: '2026-04-17',
    teLaat: false,
  })
  const result = evalueerSpoed(fakeAgenda, 120, defaultConfig(), VANDAAG)
  assertEquals(result.scenario, 'spoed_volgende_week')
})

Deno.test('evalueerSpoed: lever_datum = snij + logistieke_buffer', () => {
  const result = evalueerSpoed(new Map(), 30, defaultConfig({ logistieke_buffer_dagen: 3 }), VANDAAG)
  assert(result.snij_datum !== null && result.lever_datum !== null)
  const snij = new Date(`${result.snij_datum}T00:00:00Z`)
  const lever = new Date(`${result.lever_datum}T00:00:00Z`)
  assertEquals((lever.getTime() - snij.getTime()) / 86_400_000, 3)
})

Deno.test('evalueerSpoed: toeslag_bedrag uit cfg', () => {
  const result = evalueerSpoed(new Map(), 30, defaultConfig({ spoed_toeslag_bedrag: 75 }), VANDAAG)
  assertEquals(result.toeslag_bedrag, 75)
})

Deno.test('evalueerSpoed: week_restruimte_uren correct gerapporteerd', () => {
  const fakeAgenda = new Map<number, RolAgendaSlot>()
  fakeAgenda.set(1, {
    start: new Date('2026-04-13T08:00:00Z'),
    eind: new Date('2026-04-15T17:00:00Z'),  // ma-wo (3 × 510 min = 1530 beslag)
    klaarDatum: '2026-04-15',
    teLaat: false,
  })
  const result = evalueerSpoed(fakeAgenda, 30, defaultConfig(), VANDAAG)
  // Deze week: 5×510=2550 - 1530 - 240 buffer = 780 min = 13.0 uur
  assertEquals(result.week_restruimte_uren.deze, 13)
  // Volgende week: 2550 - 0 - 240 = 2310 / 60 = 38.5 uur
  assertEquals(result.week_restruimte_uren.volgende, 38.5)
})

Deno.test('evalueerSpoed: bestaande rol al te laat (snij = lever) → spoed niet beschikbaar', () => {
  const fakeAgenda = new Map<number, RolAgendaSlot>()
  // Stuk moet 20-04 geleverd, maar wordt pas 20-04 gesneden (geen buffer) → te laat
  fakeAgenda.set(1, {
    start: new Date('2026-04-20T08:00:00Z'),
    eind: new Date('2026-04-20T17:00:00Z'),
    klaarDatum: '2026-04-20',
    teLaat: true,
  })
  const result = evalueerSpoed(fakeAgenda, 30, defaultConfig(), VANDAAG)
  assertEquals(result.beschikbaar, false)
  assertEquals(result.scenario, 'spoed_geen_plek')
})

Deno.test('evalueerSpoed: backlog op tijd (genoeg buffer) → spoed wel beschikbaar', () => {
  const fakeAgenda = new Map<number, RolAgendaSlot>()
  fakeAgenda.set(1, {
    start: new Date('2026-04-13T08:00:00Z'),
    eind: new Date('2026-04-15T17:00:00Z'),  // wo gesneden, ruim voor leverdatum
    klaarDatum: '2026-04-15',
    teLaat: false,
  })
  const result = evalueerSpoed(fakeAgenda, 30, defaultConfig(), VANDAAG)
  assertEquals(result.beschikbaar, true)
})

Deno.test('evalueerSpoed: hogere buffer → vroege weken sneller "vol"', () => {
  const fakeAgenda = new Map<number, RolAgendaSlot>()
  fakeAgenda.set(1, {
    start: new Date('2026-04-13T08:00:00Z'),
    eind: new Date('2026-04-17T13:00:00Z'),  // 4 dagen + 4u (4×510 + 240 = 2280 min beslag)
    klaarDatum: '2026-04-17',
    teLaat: false,
  })
  // Met buffer 8u: 2550 - 2280 - 480 = -210 → niet meer
  const strict = evalueerSpoed(fakeAgenda, 30, defaultConfig({ spoed_buffer_uren: 8 }), VANDAAG)
  assertEquals(strict.scenario, 'spoed_volgende_week')
  // Met buffer 0u: 2550 - 2280 = 270 → past nog deze week
  const loose = evalueerSpoed(fakeAgenda, 30, defaultConfig({ spoed_buffer_uren: 0 }), VANDAAG)
  assertEquals(loose.scenario, 'spoed_deze_week')
})
