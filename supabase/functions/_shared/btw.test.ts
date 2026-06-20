// supabase/functions/_shared/btw.test.ts
// Deno test: `npx deno test supabase/functions/_shared/btw.test.ts --no-check`
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { effectiefBtwPct, isBtwVerlegd, isEuLand, bepaalBtwRegeling, HARD_BLOCK_REGELINGEN } from './btw.ts'

Deno.test('verlegd → 0%, ook als btw_percentage 21 is', () => {
  assertEquals(effectiefBtwPct({ btw_verlegd_intracom: true, btw_percentage: 21 }), 0)
})

Deno.test('niet-verlegd → btw_percentage van de debiteur', () => {
  assertEquals(effectiefBtwPct({ btw_verlegd_intracom: false, btw_percentage: 21 }), 21)
})

Deno.test('btw_percentage als string (PostgREST NUMERIC) → genummerd', () => {
  assertEquals(effectiefBtwPct({ btw_verlegd_intracom: false, btw_percentage: '9.00' }), 9)
})

Deno.test('NULL btw_percentage → fallback 21 (zelfde default als SQL)', () => {
  assertEquals(effectiefBtwPct({ btw_verlegd_intracom: false, btw_percentage: null }), 21)
})

Deno.test('onbruikbare string-percentages → fallback 21, nooit stil 0%', () => {
  assertEquals(effectiefBtwPct({ btw_verlegd_intracom: false, btw_percentage: 'abc' }), 21)
  assertEquals(effectiefBtwPct({ btw_verlegd_intracom: false, btw_percentage: '' }), 21)
  assertEquals(effectiefBtwPct({ btw_verlegd_intracom: false, btw_percentage: '   ' }), 21)
})

Deno.test('expliciet 0% zonder verlegd-vlag blijft 0 (export-klant)', () => {
  assertEquals(effectiefBtwPct({ btw_verlegd_intracom: false, btw_percentage: 0 }), 0)
})

Deno.test('null/undefined debiteur → fallback 21, niet verlegd', () => {
  assertEquals(effectiefBtwPct(null), 21)
  assertEquals(effectiefBtwPct(undefined), 21)
  assertEquals(isBtwVerlegd(null), false)
})

Deno.test('isBtwVerlegd: alleen expliciet TRUE telt', () => {
  assertEquals(isBtwVerlegd({ btw_verlegd_intracom: true }), true)
  assertEquals(isBtwVerlegd({ btw_verlegd_intracom: false }), false)
  assertEquals(isBtwVerlegd({ btw_verlegd_intracom: null }), false)
  assertEquals(isBtwVerlegd({}), false)
})

// ============================================================================
// Mig 454/455/456: isEuLand + bepaalBtwRegeling
// ============================================================================

Deno.test('isEuLand: EU-lidstaten true, CH/NO/GB/onbekend false', () => {
  assertEquals(isEuLand('NL'), true)
  assertEquals(isEuLand('PT'), true) // mig 454-aanvulling
  assertEquals(isEuLand('FI'), true) // mig 454-aanvulling
  assertEquals(isEuLand('CH'), false)
  assertEquals(isEuLand('NO'), false)
  assertEquals(isEuLand('GB'), false)
  assertEquals(isEuLand('SR'), false) // Suriname
  assertEquals(isEuLand(null), false)
  assertEquals(isEuLand(undefined), false)
})

Deno.test('bepaalBtwRegeling: KRITIEK — geen land bekend → nl_binnenland, geen blokkade', () => {
  // 62% van de actieve debiteuren heeft een leeg land-veld (legacy NL-klanten).
  // Dit moet het bestaande gedrag blijven — regressietest voor de fix.
  const r = bepaalBtwRegeling({ aflLandIso2: null, debiteurLandIso2: null, verlegdVlag: false, btwPercentage: 21 })
  assertEquals(r.regeling, 'nl_binnenland')
  assertEquals(r.effectiefPct, 21)
  assertEquals(r.controleNodig, false)
})

Deno.test('bepaalBtwRegeling: NL → nl_binnenland, debiteur-tarief, geen controle', () => {
  const r = bepaalBtwRegeling({ aflLandIso2: 'NL', verlegdVlag: false, btwPercentage: 21 })
  assertEquals(r.regeling, 'nl_binnenland')
  assertEquals(r.effectiefPct, 21)
  assertEquals(r.controleNodig, false)
})

Deno.test('bepaalBtwRegeling: EU + verlegd + btw-nummer → eu_b2b_icl, 0%, geen controle', () => {
  const r = bepaalBtwRegeling({
    aflLandIso2: 'DE', verlegdVlag: true, btwNummer: 'DE123456789', btwPercentage: 21,
  })
  assertEquals(r.regeling, 'eu_b2b_icl')
  assertEquals(r.effectiefPct, 0)
  assertEquals(r.controleNodig, false)
  assertEquals(HARD_BLOCK_REGELINGEN.has(r.regeling), false)
})

Deno.test('bepaalBtwRegeling: EU + verlegd zonder btw-nummer → eu_b2b_icl, advisory (niet hard-block)', () => {
  const r = bepaalBtwRegeling({ aflLandIso2: 'DE', verlegdVlag: true, btwNummer: null, btwPercentage: 21 })
  assertEquals(r.regeling, 'eu_b2b_icl')
  assertEquals(r.effectiefPct, 0)
  assertEquals(r.controleNodig, true)
  assertEquals(HARD_BLOCK_REGELINGEN.has(r.regeling), false) // mig 164-besluit: niet blokkerend
})

Deno.test('bepaalBtwRegeling: EU + niet-verlegd → mismatch, hard-block', () => {
  const r = bepaalBtwRegeling({ aflLandIso2: 'FR', verlegdVlag: false, btwPercentage: 21 })
  assertEquals(r.regeling, 'eu_b2b_binnenland_afwijking')
  assertEquals(r.effectiefPct, 21)
  assertEquals(r.controleNodig, true)
  assertEquals(HARD_BLOCK_REGELINGEN.has(r.regeling), true)
})

Deno.test('bepaalBtwRegeling: buiten EU → export_buiten_eu, 0%, hard-block', () => {
  const r = bepaalBtwRegeling({ aflLandIso2: 'US', verlegdVlag: false, btwPercentage: 21 })
  assertEquals(r.regeling, 'export_buiten_eu')
  assertEquals(r.effectiefPct, 0)
  assertEquals(r.controleNodig, true)
  assertEquals(HARD_BLOCK_REGELINGEN.has(r.regeling), true)
})

Deno.test('bepaalBtwRegeling: afhalen negeert afl_land, gebruikt debiteur.land', () => {
  const r = bepaalBtwRegeling({
    aflLandIso2: 'DE', debiteurLandIso2: 'NL', afhalen: true, verlegdVlag: false, btwPercentage: 21,
  })
  assertEquals(r.regeling, 'nl_binnenland')
  assertEquals(r.controleNodig, false)
})

Deno.test('bepaalBtwRegeling: afl_land wint van debiteur.land als beide gevuld (niet afhalen)', () => {
  const r = bepaalBtwRegeling({
    aflLandIso2: 'FR', debiteurLandIso2: 'DE', afhalen: false, verlegdVlag: true, btwNummer: 'DE1', btwPercentage: 21,
  })
  // land=FR (order), debiteur staat verlegd=true maar dat was ingesteld voor DE-leveringen —
  // de regel kijkt puur naar of het land EU is + de vlag, niet naar of vlag/land "matchen"
  // qua oorspronkelijk land. Hier: FR is EU + verlegd=true → eu_b2b_icl (zelfde als DE zou geven).
  assertEquals(r.regeling, 'eu_b2b_icl')
  assertEquals(r.landIso2, 'FR')
})
