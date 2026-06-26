import { describe, it, expect } from 'vitest'
import { isPickBackorder } from '../pick-backorder'

describe('isPickBackorder', () => {
  it('true bij open backorder', () => {
    expect(
      isPickBackorder({
        pick_backorder_sinds: '2026-06-22T10:00:00Z',
        pick_backorder_geannuleerd_op: null,
      }),
    ).toBe(true)
  })
  it('false als niet in backorder', () => {
    expect(
      isPickBackorder({
        pick_backorder_sinds: null,
        pick_backorder_geannuleerd_op: null,
      }),
    ).toBe(false)
  })
  it('false als al geannuleerd (afgehandeld)', () => {
    expect(
      isPickBackorder({
        pick_backorder_sinds: '2026-06-22T10:00:00Z',
        pick_backorder_geannuleerd_op: '2026-06-22T11:00:00Z',
      }),
    ).toBe(false)
  })
})
