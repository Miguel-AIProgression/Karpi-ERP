// Deno unit tests voor afwerking-presentatie.ts.
// Run: deno test --no-check supabase/functions/_shared/afwerking-presentatie.test.ts

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { afwerkingPresentatie, type AfwerkingTypeMap } from './afwerking-presentatie.ts'

const TYPE_MAP: AfwerkingTypeMap = new Map([
  ['B', { naam: 'Breedband', type_bewerking: 'breedband' }],
  ['SB', { naam: 'Smalband', type_bewerking: 'smalband' }],
  ['VO', { naam: 'Volume afwerking', type_bewerking: 'volume afwerking' }],
  ['ON', { naam: 'Onafgewerkt', type_bewerking: null }],
  ['ZO', { naam: 'Zijkant Omgevouwen', type_bewerking: null }],
  ['FE', { naam: 'Feston', type_bewerking: 'feston' }],
  ['FUR', { naam: 'Fur', type_bewerking: null }],
])

// --- Whitelisted afwerkingen ---

Deno.test('Breedband + bandkleur → naam met band', () => {
  assertEquals(afwerkingPresentatie('B', 'KK21', TYPE_MAP), 'Breedband - band KK21')
})

Deno.test('Breedband zonder bandkleur → alleen naam', () => {
  assertEquals(afwerkingPresentatie('B', null, TYPE_MAP), 'Breedband')
})

Deno.test('Volume afwerking → naam zonder band', () => {
  assertEquals(afwerkingPresentatie('VO', null, TYPE_MAP), 'Volume afwerking')
})

Deno.test('Onafgewerkt → naam (type_bewerking is null maar code ON is whitelisted)', () => {
  assertEquals(afwerkingPresentatie('ON', null, TYPE_MAP), 'Onafgewerkt')
})

// --- Niet-tonen op klantdocumenten ---

Deno.test('Smalband → null (niet tonen op klantdocumenten)', () => {
  assertEquals(afwerkingPresentatie('SB', 'Piero Groen 1073', TYPE_MAP), null)
})

Deno.test('ZO (Zijkant Omgevouwen) → null (niet tonen op klantdocumenten)', () => {
  assertEquals(afwerkingPresentatie('ZO', null, TYPE_MAP), null)
})

Deno.test('Feston → null (niet tonen op klantdocumenten)', () => {
  assertEquals(afwerkingPresentatie('FE', null, TYPE_MAP), null)
})

Deno.test('Fur (null type_bewerking, niet ON) → null', () => {
  assertEquals(afwerkingPresentatie('FUR', 'KK21', TYPE_MAP), null)
})

Deno.test('Onbekende code → null (veilig op klantdocumenten)', () => {
  assertEquals(afwerkingPresentatie('XX', null, TYPE_MAP), null)
})

// --- Geen code ---

Deno.test('Geen code → null', () => {
  assertEquals(afwerkingPresentatie(null, null, TYPE_MAP), null)
  assertEquals(afwerkingPresentatie(undefined, 'KK21', TYPE_MAP), null)
})
