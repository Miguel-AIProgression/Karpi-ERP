// Karakterisatie-tests voor de Artikelpresentatie-resolver.
// Pinnen de fallback-ladders zoals ze nu in factuur-verzenden buildEdiFactuurInput
// leven (ADR-0036 slice 1) — gedragsneutrale extractie.

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { resolveArtikelPresentatie, resolveKarpiCode } from './artikel-presentatie.ts'

Deno.test('resolveKarpiCode: ladder orderRegel → product → artikelnr → ""', () => {
  assertEquals(resolveKarpiCode('OR', 'PROD', 'ART'), 'OR')
  assertEquals(resolveKarpiCode(null, 'PROD', 'ART'), 'PROD')
  assertEquals(resolveKarpiCode(null, null, 'ART'), 'ART')
  assertEquals(resolveKarpiCode('  ', null, 'ART'), 'ART') // blanco overslaan
  assertEquals(resolveKarpiCode(null, null, null), '')
})

Deno.test('karpi_code: orderRegel-snapshot wint van product en artikelnr', () => {
  const p = resolveArtikelPresentatie(
    { artikelnr: 'ART1', aantal: 1 },
    {
      orderRegel: { karpi_code: 'KARPI-OR', gewicht_kg: null },
      product: { karpi_code: 'KARPI-PROD', omschrijving: null, omschrijving_2: null, ean_code: null, gewicht_kg: null },
    },
  )
  assertEquals(p.karpi_code, 'KARPI-OR')
})

Deno.test('karpi_code: valt terug op product, dan op artikelnr', () => {
  assertEquals(
    resolveArtikelPresentatie(
      { artikelnr: 'ART1', aantal: 1 },
      { product: { karpi_code: 'KARPI-PROD', omschrijving: null, omschrijving_2: null, ean_code: null, gewicht_kg: null } },
    ).karpi_code,
    'KARPI-PROD',
  )
  assertEquals(
    resolveArtikelPresentatie({ artikelnr: 'ART1', aantal: 1 }, {}).karpi_code,
    'ART1',
  )
  assertEquals(
    resolveArtikelPresentatie({ artikelnr: null, aantal: 1 }, {}).karpi_code,
    '',
  )
})

Deno.test('omschrijving: klant_artikel wint, dan regel, dan product, dan omschrijving_2', () => {
  const lookups = {
    product: { karpi_code: null, omschrijving: 'PRODUCT OMS', omschrijving_2: null, ean_code: null, gewicht_kg: null },
  }
  // klant-artikel omschrijving wint
  assertEquals(
    resolveArtikelPresentatie(
      { artikelnr: 'ART1', omschrijving: 'REGEL OMS', aantal: 1 },
      { ...lookups, klantArtikel: { klant_artikel: 'KL1', omschrijving: 'KLANT OMS' } },
    ).omschrijving,
    'KLANT OMS',
  )
  // anders regel
  assertEquals(
    resolveArtikelPresentatie({ artikelnr: 'ART1', omschrijving: 'REGEL OMS', aantal: 1 }, lookups).omschrijving,
    'REGEL OMS',
  )
  // anders product
  assertEquals(
    resolveArtikelPresentatie({ artikelnr: 'ART1', aantal: 1 }, lookups).omschrijving,
    'PRODUCT OMS',
  )
  // anders omschrijving_2
  assertEquals(
    resolveArtikelPresentatie({ artikelnr: 'ART1', omschrijving_2: 'OMS2', aantal: 1 }, {}).omschrijving,
    'OMS2',
  )
})

Deno.test('gtin en klant_artikel: leeg-string als niet gevonden', () => {
  const p = resolveArtikelPresentatie({ artikelnr: 'ART1', aantal: 1 }, {})
  assertEquals(p.gtin, '')
  assertEquals(p.klant_artikel, '')

  const q = resolveArtikelPresentatie(
    { artikelnr: 'ART1', aantal: 1 },
    {
      product: { karpi_code: null, omschrijving: null, omschrijving_2: null, ean_code: '8712345678901', gewicht_kg: null },
      klantArtikel: { klant_artikel: 'KL-9', omschrijving: null },
    },
  )
  assertEquals(q.gtin, '8712345678901')
  assertEquals(q.klant_artikel, 'KL-9')
})

Deno.test('gewicht: orderRegel-snapshot wint van product×aantal', () => {
  // orderRegel-snapshot wint, ongeacht aantal
  assertEquals(
    resolveArtikelPresentatie(
      { artikelnr: 'ART1', aantal: 3 },
      {
        orderRegel: { karpi_code: null, gewicht_kg: 12.5 },
        product: { karpi_code: null, omschrijving: null, omschrijving_2: null, ean_code: null, gewicht_kg: 4 },
      },
    ).gewicht_kg,
    12.5,
  )
  // geen orderRegel-gewicht → product × aantal
  assertEquals(
    resolveArtikelPresentatie(
      { artikelnr: 'ART1', aantal: 3 },
      { product: { karpi_code: null, omschrijving: null, omschrijving_2: null, ean_code: null, gewicht_kg: 4 } },
    ).gewicht_kg,
    12,
  )
  // niets bekend → 0
  assertEquals(resolveArtikelPresentatie({ artikelnr: 'ART1', aantal: 3 }, {}).gewicht_kg, 0)
})

Deno.test('artikel_tekst: "[karpi_code] [omschrijving]", lege delen weggefilterd', () => {
  // volledig
  assertEquals(
    resolveArtikelPresentatie(
      { artikelnr: 'ART1', omschrijving: 'BANGKOK KLEUR 21', aantal: 1 },
      { orderRegel: { karpi_code: 'BAN21', gewicht_kg: null } },
    ).artikel_tekst,
    'BAN21 BANGKOK KLEUR 21',
  )
  // alleen omschrijving (karpi_code valt terug op artikelnr, dus altijd iets) — test pure lege karpi
  assertEquals(
    resolveArtikelPresentatie({ artikelnr: null, omschrijving: 'LOSSE OMS', aantal: 1 }, {}).artikel_tekst,
    'LOSSE OMS',
  )
  // beide leeg → lege string
  assertEquals(resolveArtikelPresentatie({ artikelnr: null, aantal: 1 }, {}).artikel_tekst, '')
})
