// Tests voor factuurProductTitel: "kwaliteitnaam (of klant-eigennaam) − afmeting".

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { factuurProductTitel } from './factuur-product-titel.ts'

const VAST = {
  isMaatwerk: false,
  maatwerkLengteCm: null,
  maatwerkBreedteCm: null,
  vervolgomschrijving: 'GALAXY Kleur 21 CA: 60x90 cm',
  prodLengteCm: 90,
  prodBreedteCm: 60,
  klantEigenNaam: null,
}

Deno.test('vast: kwaliteitnaam + maat (kleinste zijde eerst)', () => {
  assertEquals(factuurProductTitel(VAST), 'GALAXY - 60x90 cm')
})

Deno.test('klant-eigennaam wint van kwaliteitnaam', () => {
  assertEquals(factuurProductTitel({ ...VAST, klantEigenNaam: 'BREDA' }), 'BREDA - 60x90 cm')
  // Whitespace-eigennaam telt niet → val terug op kwaliteitnaam.
  assertEquals(factuurProductTitel({ ...VAST, klantEigenNaam: '  ' }), 'GALAXY - 60x90 cm')
})

Deno.test('maatwerk: maatwerk-maten tellen, product-maten genegeerd', () => {
  assertEquals(
    factuurProductTitel({
      isMaatwerk: true,
      maatwerkLengteCm: 330,
      maatwerkBreedteCm: 240,
      vervolgomschrijving: 'EGYPTISCHE WOL Kleur 3',
      prodLengteCm: 90,
      prodBreedteCm: 60,
      klantEigenNaam: null,
    }),
    'EGYPTISCHE WOL - 240x330 cm',
  )
})

Deno.test('geen naam → null (val terug op bestaande omschrijving)', () => {
  assertEquals(factuurProductTitel({ ...VAST, vervolgomschrijving: 'PATS23XX060090', klantEigenNaam: null }), null)
  assertEquals(factuurProductTitel({ ...VAST, vervolgomschrijving: null, klantEigenNaam: null }), null)
})

Deno.test('geen of nul-maat → null', () => {
  assertEquals(factuurProductTitel({ ...VAST, prodLengteCm: null }), null)
  assertEquals(factuurProductTitel({ ...VAST, prodBreedteCm: 0 }), null)
  // Maatwerk zonder maatwerk-maten → null (ook als product-maten bestaan).
  assertEquals(
    factuurProductTitel({ ...VAST, isMaatwerk: true, maatwerkLengteCm: null, maatwerkBreedteCm: null }),
    null,
  )
})
