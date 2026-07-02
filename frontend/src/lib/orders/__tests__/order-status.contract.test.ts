// Contracttest: TS-waardenlijst order_status ≡ golden-fixture ≡ mig 350-assert
// (set-semantiek, volgorde niet betekenis-dragend) + ORDER_STATUS_COLORS als
// eerste geautomatiseerde spiegel (mig 350 noemde die als handmatige spiegel).
import { describe, it, expect } from 'vitest'
import golden from '../../../../../supabase/functions/_shared/order-lifecycle/__tests__/order-status.golden.json'
import {
  ORDER_STATUSSEN,
  ORDER_STATUSSEN_CANONIEK,
  ORDER_STATUSSEN_LEGACY,
} from '../../../../../supabase/functions/_shared/order-lifecycle/order-status'
import { ORDER_STATUS_COLORS } from '@/lib/utils/constants'

const asSortedSet = (xs: readonly string[]) => [...new Set(xs)].sort()

describe('order_status contract: TS ≡ golden (set-semantiek, mirrort mig 350)', () => {
  it('canoniek dekt exact golden.canoniek', () => {
    expect(asSortedSet(ORDER_STATUSSEN_CANONIEK)).toEqual(asSortedSet(golden.canoniek))
  })

  it('legacy dekt exact golden.legacy', () => {
    expect(asSortedSet(ORDER_STATUSSEN_LEGACY)).toEqual(asSortedSet(golden.legacy))
  })

  it('totaal = 18 waarden, geen dubbelen, geen overlap canoniek/legacy', () => {
    expect(ORDER_STATUSSEN).toHaveLength(18)
    expect(asSortedSet(ORDER_STATUSSEN)).toHaveLength(18)
  })

  it('ORDER_STATUS_COLORS dekt exact alle enum-waarden (mig 350-spiegel geautomatiseerd)', () => {
    expect(asSortedSet(Object.keys(ORDER_STATUS_COLORS))).toEqual(asSortedSet(ORDER_STATUSSEN))
  })
})
