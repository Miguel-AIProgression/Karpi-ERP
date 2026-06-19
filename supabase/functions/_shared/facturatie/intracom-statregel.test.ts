// Tests voor de Intrastat-Stat.nr.-regel (mig 446) — gedeeld tussen
// factuur-pdf (preview) en factuur-verzenden (de daadwerkelijk verzonden
// factuur).

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { bereekenM2PerStuk, bouwIntracomStatRegel } from './intracom-statregel.ts'
import { intracomRegelLabel } from '../factuur-pdf.ts'

Deno.test('bouwIntracomStatRegel: geen regel als niet btw_verlegd', () => {
  const r = bouwIntracomStatRegel({
    taal: 'nl', btwVerlegd: false, goederencode: '57024200', gewichtKg: 16, m2Totaal: 4,
  })
  assertEquals(r, undefined)
})

Deno.test('bouwIntracomStatRegel: geen regel zonder goederencode (kwaliteit nog onbekend)', () => {
  const r = bouwIntracomStatRegel({
    taal: 'nl', btwVerlegd: true, goederencode: undefined, gewichtKg: 16, m2Totaal: 4,
  })
  assertEquals(r, undefined)
})

Deno.test('bouwIntracomStatRegel: NL-label + waarden, gewicht afgerond op heel getal', () => {
  const r = bouwIntracomStatRegel({
    taal: 'nl', btwVerlegd: true, goederencode: '57024200', gewichtKg: 15.6, m2Totaal: 4.0,
  })
  assertEquals(r, 'Stat.nr./Land herkomst/Vervoer/Gewicht: 57024200/NL/3/16\nM2: 4.00')
})

Deno.test('bouwIntracomStatRegel: geen M2-regel als m2Totaal 0 is (bv. geen maat bekend)', () => {
  const r = bouwIntracomStatRegel({
    taal: 'de', btwVerlegd: true, goederencode: '57024290', gewichtKg: 576, m2Totaal: 0,
  })
  assertEquals(r, 'Stat.nr./Ursprungsland/Transp./Gewicht: 57024290/NL/3/576')
})

Deno.test('bouwIntracomStatRegel: ontbrekend gewicht → 0', () => {
  const r = bouwIntracomStatRegel({
    taal: 'en', btwVerlegd: true, goederencode: '57024200', gewichtKg: null, m2Totaal: 0,
  })
  assertEquals(r, 'Stat. no./Country of origin/Transport/Weight: 57024200/NL/3/0')
})

Deno.test('intracomRegelLabel: label per taal (matcht legacy DE-export)', () => {
  assertEquals(intracomRegelLabel('de'), 'Stat.nr./Ursprungsland/Transp./Gewicht')
  assertEquals(intracomRegelLabel('nl'), 'Stat.nr./Land herkomst/Vervoer/Gewicht')
  assertEquals(intracomRegelLabel('fr'), 'N° stat./Pays d’origine/Transport/Poids')
  assertEquals(intracomRegelLabel('en'), 'Stat. no./Country of origin/Transport/Weight')
})

Deno.test('bereekenM2PerStuk: maatwerk-snapshot wint van product-maat', () => {
  const m2 = bereekenM2PerStuk({
    maatwerkOppervlakM2: 3.5,
    productLengteCm: 200,
    productBreedteCm: 300,
    productVorm: 'rechthoek',
  })
  assertEquals(m2, 3.5)
})

Deno.test('bereekenM2PerStuk: rechthoek uit product-maat (geen maatwerk)', () => {
  const m2 = bereekenM2PerStuk({
    maatwerkOppervlakM2: null,
    productLengteCm: 200,
    productBreedteCm: 300,
    productVorm: 'rechthoek',
  })
  assertEquals(m2, 6) // 200*300/10000
})

Deno.test('bereekenM2PerStuk: rond product → cirkel-oppervlak', () => {
  const m2 = bereekenM2PerStuk({
    maatwerkOppervlakM2: null,
    productLengteCm: 200,
    productBreedteCm: 200,
    productVorm: 'rond',
  })
  // π × (200/200)² = π
  assertEquals(Math.abs(m2 - Math.PI) < 0.0001, true)
})

Deno.test('bereekenM2PerStuk: geen maat bekend → 0', () => {
  const m2 = bereekenM2PerStuk({
    maatwerkOppervlakM2: null,
    productLengteCm: null,
    productBreedteCm: null,
    productVorm: null,
  })
  assertEquals(m2, 0)
})
