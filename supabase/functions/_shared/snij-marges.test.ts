// Deno unit tests voor snij-marges.ts
// Run: deno test supabase/functions/_shared/snij-marges.test.ts

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { snijMargeCm } from './snij-marges.ts'

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
