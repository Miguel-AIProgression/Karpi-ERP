import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { toIntakeRegel } from './lightspeed-regels.ts'

Deno.test('toIntakeRegel: standaard artikel', () => {
  const r = toIntakeRegel({
    omschrijving: 'Tapijt Blauw',
    omschrijving_2: '200x300',
    aantal: 2,
    prijs: 50,
    gewicht_kg: 4.21,
    match: { artikelnr: 'ART-1', matchedOn: 'artikelnr', is_maatwerk: false },
    dims: null,
  })
  assertEquals(r.artikelnr, 'ART-1')
  assertEquals(r.orderaantal, 2)
  assertEquals(r.te_leveren, 2)
  assertEquals(r.bedrag, 100) // 50 * 2
  assertEquals(r.gewicht_kg, 4.21)
  assertEquals(r.is_maatwerk, false)
  assertEquals(r.maatwerk_vorm, null)
})

Deno.test('toIntakeRegel: maatwerk met vorm + dims', () => {
  const r = toIntakeRegel({
    omschrijving: 'Op maat',
    omschrijving_2: null,
    aantal: 1,
    prijs: null,
    gewicht_kg: null,
    match: { artikelnr: null, matchedOn: 'maatwerk', is_maatwerk: true, maatwerk_kwaliteit_code: 'KW', maatwerk_kleur_code: 'KL', maatwerk_vorm: 'ovaal' },
    dims: { lengte: 140, breedte: 200 },
  })
  assertEquals(r.is_maatwerk, true)
  assertEquals(r.maatwerk_vorm, 'ovaal')
  assertEquals(r.maatwerk_lengte_cm, 140)
  assertEquals(r.maatwerk_breedte_cm, 200)
  assertEquals(r.prijs, null)
  assertEquals(r.bedrag, null) // prijs null → bedrag null
})
