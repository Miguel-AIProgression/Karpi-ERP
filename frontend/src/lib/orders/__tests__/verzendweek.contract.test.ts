import { describe, expect, it } from 'vitest'
import golden from './golden/verzendweek.golden.json'
import { verzendWeekSleutel } from '../verzendweek'

describe('verzendweek golden contract (TS-kant)', () => {
  for (const c of golden.cases) {
    it(`${c.datum} → ${c.verwacht}`, () => {
      expect(verzendWeekSleutel(c.datum)).toBe(c.verwacht)
    })
  }
})
