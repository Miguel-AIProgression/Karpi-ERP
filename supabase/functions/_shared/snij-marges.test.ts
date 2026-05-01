// Deno unit tests voor snij-marges.ts
// Run: deno test supabase/functions/_shared/snij-marges.test.ts

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { snijMargeCm, isNietRechthoekigeVorm } from './snij-marges.ts'

Deno.test('geen afwerking of vorm → 0', () => {
  assertEquals(snijMargeCm(null, null), 0)
  assertEquals(snijMargeCm(undefined, undefined), 0)
  assertEquals(snijMargeCm('', ''), 0)
})

Deno.test('ZO-afwerking → +6 cm', () => {
  assertEquals(snijMargeCm('ZO', null), 6)
  assertEquals(snijMargeCm('ZO', ''), 6)
  assertEquals(snijMargeCm('ZO', 'vierkant'), 6)
})

Deno.test('rond of ovaal → +5 cm', () => {
  assertEquals(snijMargeCm(null, 'rond'), 5)
  assertEquals(snijMargeCm(null, 'Rond'), 5)
  assertEquals(snijMargeCm(null, 'OVAAL'), 5)
  assertEquals(snijMargeCm('', 'ovaal'), 5)
})

Deno.test('ZO + rond → grootste (6), niet cumulatief', () => {
  assertEquals(snijMargeCm('ZO', 'rond'), 6)
  assertEquals(snijMargeCm('ZO', 'ovaal'), 6)
})

Deno.test('andere afwerkingen geven geen marge', () => {
  assertEquals(snijMargeCm('B', null), 0)
  assertEquals(snijMargeCm('FE', null), 0)
  assertEquals(snijMargeCm('LO', null), 0)
  assertEquals(snijMargeCm('ON', null), 0)
  assertEquals(snijMargeCm('SB', null), 0)
  assertEquals(snijMargeCm('SF', null), 0)
  assertEquals(snijMargeCm('VO', null), 0)
})

Deno.test('vrije vorm/rechthoek/vierkant geven geen marge', () => {
  assertEquals(snijMargeCm(null, 'vierkant'), 0)
  assertEquals(snijMargeCm(null, 'rechthoek'), 0)
  assertEquals(snijMargeCm(null, 'free-form'), 0)
})

Deno.test('organische vormen → +5 cm', () => {
  assertEquals(snijMargeCm(null, 'organisch_a'), 5)
  assertEquals(snijMargeCm(null, 'organisch_b_sp'), 5)
  assertEquals(snijMargeCm(null, 'pebble'), 5)
  assertEquals(snijMargeCm(null, 'ellips'), 5)
  assertEquals(snijMargeCm(null, 'afgeronde_hoeken'), 5)
})

Deno.test('rechthoek blijft 0', () => {
  assertEquals(snijMargeCm(null, 'rechthoek'), 0)
})

Deno.test('cloud wordt niet als vorm-marge behandeld (niet in plan)', () => {
  assertEquals(snijMargeCm(null, 'cloud'), 0)
})

Deno.test('isNietRechthoekigeVorm herkent alle 7 vormen', () => {
  assertEquals(isNietRechthoekigeVorm('rond'), true)
  assertEquals(isNietRechthoekigeVorm('ovaal'), true)
  assertEquals(isNietRechthoekigeVorm('organisch_a'), true)
  assertEquals(isNietRechthoekigeVorm('organisch_b_sp'), true)
  assertEquals(isNietRechthoekigeVorm('pebble'), true)
  assertEquals(isNietRechthoekigeVorm('ellips'), true)
  assertEquals(isNietRechthoekigeVorm('afgeronde_hoeken'), true)
})

Deno.test('isNietRechthoekigeVorm geeft false voor rechthoekige vormen', () => {
  assertEquals(isNietRechthoekigeVorm('rechthoek'), false)
  assertEquals(isNietRechthoekigeVorm('vierkant'), false)
  assertEquals(isNietRechthoekigeVorm('cloud'), false)
  assertEquals(isNietRechthoekigeVorm(null), false)
  assertEquals(isNietRechthoekigeVorm(undefined), false)
  assertEquals(isNietRechthoekigeVorm(''), false)
})
