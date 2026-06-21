// Tests voor de Intrastat-Stat.nr.-regel (mig 446, herontworpen mig 450) —
// gedeeld tussen factuur-pdf (preview) en factuur-verzenden (de daadwerkelijk
// verzonden factuur).

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { bereekenM2PerStuk, bouwIntracomStatRegel } from './intracom-statregel.ts'
import { intracomLabels } from '../factuur-pdf.ts'

Deno.test('bouwIntracomStatRegel: geen regel als niet btw_verlegd', () => {
  const r = bouwIntracomStatRegel({
    taal: 'nl', btwVerlegd: false, goederencode: '57024200', gewichtKg: 16, m2Totaal: 4, vervoerderCode: 'RHE',
  })
  assertEquals(r, undefined)
})

Deno.test('bouwIntracomStatRegel: geen regel zonder goederencode (kwaliteit nog onbekend)', () => {
  const r = bouwIntracomStatRegel({
    taal: 'nl', btwVerlegd: true, goederencode: undefined, gewichtKg: 16, m2Totaal: 4, vervoerderCode: 'RHE',
  })
  assertEquals(r, undefined)
})

Deno.test('bouwIntracomStatRegel: NL — 2 compacte regels, gewicht afgerond, vervoerder-code', () => {
  const r = bouwIntracomStatRegel({
    taal: 'nl', btwVerlegd: true, goederencode: '57024200', gewichtKg: 15.6, m2Totaal: 4.0, vervoerderCode: 'RHE',
  })
  assertEquals(r, 'Stat.nr.: 57024200   Herkomst: NL   Vervoer: RHE\nGewicht: 16 kg   M2: 4.00')
})

Deno.test('bouwIntracomStatRegel: geen M2-suffix als m2Totaal 0 is (bv. geen maat bekend)', () => {
  const r = bouwIntracomStatRegel({
    taal: 'de', btwVerlegd: true, goederencode: '57024290', gewichtKg: 576, m2Totaal: 0, vervoerderCode: 'HST',
  })
  assertEquals(r, 'Stat.nr.: 57024290   Ursprung: NL   Transport: HST\nGewicht: 576 kg')
})

Deno.test('bouwIntracomStatRegel: ontbrekend gewicht → 0, ontbrekende vervoerder → "—"', () => {
  const r = bouwIntracomStatRegel({
    taal: 'en', btwVerlegd: true, goederencode: '57024200', gewichtKg: null, m2Totaal: 0, vervoerderCode: undefined,
  })
  assertEquals(r, 'Stat no.: 57024200   Origin: NL   Transport: —\nWeight: 0 kg')
})

Deno.test('bouwIntracomStatRegel: beide regels passen ruim binnen de PDF-kolombreedte (≤52 tekens @9pt Courier)', () => {
  // Regressietest voor de afkap-bug (2026-06-20): de oude 1-regel-vorm liep
  // over de kolombreedte heen waardoor Vervoer+Gewicht stilletjes verdwenen.
  const MAX_CHARS = 52
  const r = bouwIntracomStatRegel({
    taal: 'en', btwVerlegd: true, goederencode: '57024200', gewichtKg: 999, m2Totaal: 999.99, vervoerderCode: 'RHE',
  })
  for (const regel of (r ?? '').split('\n')) {
    if (regel.length > MAX_CHARS) throw new Error(`Regel te lang (${regel.length} > ${MAX_CHARS}): "${regel}"`)
  }
})

Deno.test('intracomLabels: korte labels per taal (matchen legacy DE-export waar relevant)', () => {
  assertEquals(intracomLabels('de'), { statnr: 'Stat.nr.', herkomst: 'Ursprung', vervoer: 'Transport', gewicht: 'Gewicht' })
  assertEquals(intracomLabels('nl').herkomst, 'Herkomst')
  assertEquals(intracomLabels('fr').statnr, 'N° stat.')
  assertEquals(intracomLabels('en').vervoer, 'Transport')
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
