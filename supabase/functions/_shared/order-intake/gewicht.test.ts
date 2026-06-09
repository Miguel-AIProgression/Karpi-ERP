// Deno unit tests voor de gedeelde Lightspeed-gewicht-normalisatie.
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { kgVanLightspeedGewicht } from './gewicht.ts'

Deno.test('kgVanLightspeedGewicht: micro-kg → kg met 2 decimalen', () => {
  // 4210000 micro-kg = 4.21 kg (zie sync-webshop-order:66-72 voorbeeld)
  assertEquals(kgVanLightspeedGewicht(4210000), 4.21)
  assertEquals(kgVanLightspeedGewicht(1000000), 1)
  assertEquals(kgVanLightspeedGewicht(1500000), 1.5)
})

Deno.test('kgVanLightspeedGewicht: null/NaN/negatief → null', () => {
  assertEquals(kgVanLightspeedGewicht(undefined), null)
  assertEquals(kgVanLightspeedGewicht(Number.NaN), null)
  assertEquals(kgVanLightspeedGewicht(-5), null)
})

Deno.test('kgVanLightspeedGewicht: absurd hoog → null (begrenzing NUMERIC(8,2))', () => {
  assertEquals(kgVanLightspeedGewicht(1_000_000 * 1_000_000), null)
})
