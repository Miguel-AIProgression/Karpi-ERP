// supabase/functions/_shared/btw.test.ts
// Deno test: `npx deno test supabase/functions/_shared/btw.test.ts --no-check`
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { effectiefBtwPct, isBtwVerlegd } from './btw.ts'

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
