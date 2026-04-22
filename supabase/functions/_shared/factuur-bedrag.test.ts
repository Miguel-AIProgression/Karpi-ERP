// Deno test: `deno test supabase/functions/_shared/factuur-bedrag.test.ts`
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { berekenFactuurTotalen } from './factuur-bedrag.ts'

Deno.test('berekenFactuurTotalen: enkele regel', () => {
  const result = berekenFactuurTotalen([{ bedrag: 100 }], 21)
  assertEquals(result.subtotaal, 100)
  assertEquals(result.btw_bedrag, 21)
  assertEquals(result.totaal, 121)
})

Deno.test('berekenFactuurTotalen: meerdere regels, centen-afronding', () => {
  const result = berekenFactuurTotalen(
    [{ bedrag: 33.33 }, { bedrag: 66.67 }, { bedrag: 10.01 }],
    21,
  )
  assertEquals(result.subtotaal, 110.01)
  assertEquals(result.btw_bedrag, 23.10)   // 110.01 * 0.21 = 23.1021 → round 23.10
  assertEquals(result.totaal, 133.11)
})

Deno.test('berekenFactuurTotalen: lege input → nullen', () => {
  const result = berekenFactuurTotalen([], 21)
  assertEquals(result.subtotaal, 0)
  assertEquals(result.btw_bedrag, 0)
  assertEquals(result.totaal, 0)
})

Deno.test('berekenFactuurTotalen: 0% BTW (intracom/export)', () => {
  const result = berekenFactuurTotalen([{ bedrag: 500 }, { bedrag: 250.50 }], 0)
  assertEquals(result.subtotaal, 750.50)
  assertEquals(result.btw_bedrag, 0)
  assertEquals(result.totaal, 750.50)
})
