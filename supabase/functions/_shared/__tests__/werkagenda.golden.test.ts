// Golden-contracttest (Deno-kant). De Vitest-tegenhanger leest dezelfde JSON:
// frontend/src/lib/utils/__tests__/werkagenda.contract.test.ts.
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import golden from './werkagenda.golden.json' with { type: 'json' }
import { STANDAARD_WERKTIJDEN, werkdagMinN, type Werktijden } from '../werkagenda.ts'

for (const c of golden.cases) {
  Deno.test(`werkdagMinN golden: ${c.naam}`, () => {
    const cc = c as { iso: string; n: number; verwacht: string; vrij?: string[]; werkdagen?: number[] }
    const w: Werktijden = {
      ...STANDAARD_WERKTIJDEN,
      werkdagen: cc.werkdagen ?? STANDAARD_WERKTIJDEN.werkdagen,
      vrij: (cc.vrij ?? []).map((datum) => ({ datum })),
    }
    assertEquals(werkdagMinN(cc.iso, cc.n, w), cc.verwacht)
  })
}
