// Deno unit tests voor afwerking-presentatie.ts.
// Run: deno test --no-check supabase/functions/_shared/afwerking-presentatie.test.ts

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { afwerkingPresentatie, type AfwerkingTypeMap } from './afwerking-presentatie.ts'

const TYPE_MAP: AfwerkingTypeMap = new Map([
  ['B', { naam: 'Breedband', type_bewerking: 'breedband' }],
  ['SB', { naam: 'Smalband', type_bewerking: 'smalband' }],
  ['ON', { naam: 'Onafgewerkt', type_bewerking: null }],
  ['FUR', { naam: 'Fur', type_bewerking: null }],
])

Deno.test('Breedband + bandkleur → naam met band', () => {
  assertEquals(afwerkingPresentatie('B', 'KK21', TYPE_MAP), 'Breedband - band KK21')
})

Deno.test('Breedband zonder bandkleur → alleen naam', () => {
  assertEquals(afwerkingPresentatie('B', null, TYPE_MAP), 'Breedband')
})

Deno.test('Smalband + bandkleur → band wordt NIET getoond (alleen Breedband toont band)', () => {
  assertEquals(afwerkingPresentatie('SB', 'Piero Groen 1073', TYPE_MAP), 'Smalband')
})

Deno.test('Fur (heeft_band_kleur in DB, maar geen type_bewerking breedband) → geen band', () => {
  assertEquals(afwerkingPresentatie('FUR', 'KK21', TYPE_MAP), 'Fur')
})

Deno.test('Onafgewerkt zonder band → alleen naam', () => {
  assertEquals(afwerkingPresentatie('ON', null, TYPE_MAP), 'Onafgewerkt')
})

Deno.test('Onbekende code → code zelf als fallback-naam', () => {
  assertEquals(afwerkingPresentatie('XX', null, TYPE_MAP), 'XX')
})

Deno.test('Geen code → null', () => {
  assertEquals(afwerkingPresentatie(null, null, TYPE_MAP), null)
  assertEquals(afwerkingPresentatie(undefined, 'KK21', TYPE_MAP), null)
})
