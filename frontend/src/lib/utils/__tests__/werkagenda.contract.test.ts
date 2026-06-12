// Contracttest: de frontend consumeert exact dezelfde werkagenda-kernel als
// de edge (geen mirror; plan 2026-06-12-werkagenda-een-bron). Deze test pint
// de werkdag-semantiek met dezelfde golden fixture als de Deno-test —
// patroon: derive-status.test.ts.
import { describe, it, expect } from 'vitest'
import golden from '../../../../../supabase/functions/_shared/__tests__/werkagenda.golden.json'
import { STANDAARD_WERKTIJDEN, werkdagMinN, type Werktijden } from '../bereken-agenda'

describe('werkagenda: frontend ≡ golden truthtable', () => {
  for (const c of golden.cases) {
    it(c.naam, () => {
      const cc = c as { iso: string; n: number; verwacht: string; vrij?: string[]; werkdagen?: number[] }
      const w: Werktijden = {
        ...STANDAARD_WERKTIJDEN,
        werkdagen: cc.werkdagen ?? STANDAARD_WERKTIJDEN.werkdagen,
        vrij: (cc.vrij ?? []).map((datum) => ({ datum })),
      }
      expect(werkdagMinN(cc.iso, cc.n, w)).toBe(cc.verwacht)
    })
  }
})
