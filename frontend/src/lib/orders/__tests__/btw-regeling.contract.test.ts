import { describe, expect, it } from 'vitest'
import golden from './golden/btw-regeling.golden.json'
import { bepaalBtwRegeling } from '../btw'

// Golden-contract: dezelfde fixtures voeden straks assert_btw_regeling_contract
// (SQL-migratie, patroon mig 385/389). TS-kant hier; SQL-kant volgt.
describe('btw-regeling golden contract (TS-kant)', () => {
  for (const c of golden.cases) {
    it(c.naam, () => {
      const r = bepaalBtwRegeling(c.input)
      expect(r.regeling).toBe(c.verwacht.regeling)
      expect(r.effectiefPct).toBe(c.verwacht.effectiefPct)
      expect(r.controleNodig).toBe(c.verwacht.controleNodig)
    })
  }
})
