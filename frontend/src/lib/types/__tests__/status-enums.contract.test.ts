import { describe, it, expect } from 'vitest'
import golden from './status-enums.golden.json'
import {
  SNIJPLAN_STATUSSEN,
  CONFECTIE_STATUSSEN,
} from '@/lib/utils/snijplan-status'

const asSet = (xs: readonly string[]) => new Set(xs)

describe('status-enum contract: TS ≡ DB-snapshot', () => {
  it('SNIJPLAN_STATUSSEN dekt exact snijplan_status', () => {
    expect(asSet(SNIJPLAN_STATUSSEN)).toEqual(asSet(golden.snijplan_status))
  })

  it('CONFECTIE_STATUSSEN dekt exact confectie_status', () => {
    expect(asSet(CONFECTIE_STATUSSEN)).toEqual(asSet(golden.confectie_status))
  })

  it('geen dubbele waarden binnen een enum-array', () => {
    expect(SNIJPLAN_STATUSSEN.length).toBe(asSet(SNIJPLAN_STATUSSEN).size)
    expect(CONFECTIE_STATUSSEN.length).toBe(asSet(CONFECTIE_STATUSSEN).size)
  })
})
