// Deno unit tests voor orderbevestiging-taal.ts.
// Run: deno test --no-check supabase/functions/_shared/orderbevestiging-taal.test.ts

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { bepaalTaal, vertaalOmschrijving } from './orderbevestiging-taal.ts'

Deno.test('bepaalTaal: land → taal', () => {
  assertEquals(bepaalTaal('DE'), 'de')
  assertEquals(bepaalTaal('AT'), 'de')
  assertEquals(bepaalTaal('FR'), 'fr')
  assertEquals(bepaalTaal('NL'), 'nl')
  assertEquals(bepaalTaal('BE'), 'nl')
  assertEquals(bepaalTaal('US'), 'en')
  assertEquals(bepaalTaal(null), 'en')
})

Deno.test('vertaalOmschrijving: nl blijft ongewijzigd', () => {
  assertEquals(vertaalOmschrijving('Lago 21 - 220x220 cm - afwerking: Smalband', 'nl'), 'Lago 21 - 220x220 cm - afwerking: Smalband')
})

Deno.test('vertaalOmschrijving: "afwerking:"-label vertaalt, afwerkingsnaam blijft Nederlands', () => {
  assertEquals(
    vertaalOmschrijving('Lago 21 - 220x220 cm - afwerking: Smalband', 'de'),
    'Lago 21 - 220x220 cm - Verarbeitung: Smalband',
  )
  assertEquals(
    vertaalOmschrijving('Lago 21 - 220x220 cm - afwerking: Smalband', 'fr'),
    'Lago 21 - 220x220 cm - finition: Smalband',
  )
  assertEquals(
    vertaalOmschrijving('Lago 21 - 220x220 cm - afwerking: Smalband', 'en'),
    'Lago 21 - 220x220 cm - finish: Smalband',
  )
})

Deno.test('vertaalOmschrijving: "band" als los woord vertaalt, "Breedband"/"Smalband" blijven heel', () => {
  assertEquals(
    vertaalOmschrijving('... - afwerking: Breedband - band KK21', 'de'),
    '... - Verarbeitung: Breedband - band KK21',
  )
  assertEquals(
    vertaalOmschrijving('... - afwerking: Breedband - band KK21', 'fr'),
    '... - finition: Breedband - bande KK21',
  )
})

Deno.test('vertaalOmschrijving: "Volume afwerking" (afwerkingsnaam zonder colon) wordt NIET meevertaald', () => {
  assertEquals(
    vertaalOmschrijving('... - afwerking: Volume afwerking', 'de'),
    '... - Verarbeitung: Volume afwerking',
  )
})

Deno.test('vertaalOmschrijving: bestaand gedrag (Op maat, Rond, Kleur) ongewijzigd', () => {
  assertEquals(vertaalOmschrijving('Op maat Rond Kleur 21', 'de'), 'Nach Maß Rund Farbe 21')
})
