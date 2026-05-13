import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBundelGroupedOrders } from '../use-bundel-grouped-orders'
import type { OrderRow } from '@/lib/supabase/queries/orders'

function makeOrder(over: Partial<OrderRow> & { id: number; order_nr: string }): OrderRow {
  return {
    oud_order_nr: null,
    debiteur_nr: 260000,
    klant_referentie: null,
    orderdatum: '2026-05-13',
    afleverdatum: '2026-05-15',
    status: 'In pickronde',
    aantal_regels: 2,
    totaal_bedrag: 100,
    totaal_gewicht: 5,
    vertegenw_code: null,
    klant_naam: 'FLOORPASSION',
    ...over,
  }
}

describe('useBundelGroupedOrders', () => {
  it('produceert enkel solo-rijen wanneer geen bundel-info aanwezig is', () => {
    const orders = [
      makeOrder({ id: 1, order_nr: 'ORD-2026-2050' }),
      makeOrder({ id: 2, order_nr: 'ORD-2026-2051' }),
    ]
    const { result } = renderHook(() => useBundelGroupedOrders(orders))
    expect(result.current).toHaveLength(2)
    expect(result.current.every((i) => i.kind === 'solo')).toBe(true)
  })

  it('groepeert orders met dezelfde bundel_zending_nr in één bundel-item', () => {
    const orders = [
      makeOrder({
        id: 1,
        order_nr: 'ORD-2026-2058',
        bundel_zending_nr: 'ZEND-2026-0017',
        bundel_order_count: 2,
      }),
      makeOrder({
        id: 2,
        order_nr: 'ORD-2026-2057',
        bundel_zending_nr: 'ZEND-2026-0017',
        bundel_order_count: 2,
      }),
      makeOrder({
        id: 3,
        order_nr: 'ORD-2026-2056',
      }),
    ]
    const { result } = renderHook(() => useBundelGroupedOrders(orders))
    expect(result.current).toHaveLength(2)
    expect(result.current[0]).toMatchObject({ kind: 'bundel', zending_nr: 'ZEND-2026-0017' })
    if (result.current[0].kind === 'bundel') {
      expect(result.current[0].orders).toHaveLength(2)
      // Sortering oplopend op order_nr — 2057 vóór 2058
      expect(result.current[0].orders[0].order_nr).toBe('ORD-2026-2057')
      expect(result.current[0].orders[1].order_nr).toBe('ORD-2026-2058')
    }
    expect(result.current[1]).toMatchObject({ kind: 'solo' })
  })

  it('behandelt bundel_order_count < 2 als solo (defensief tegen rotte data)', () => {
    const orders = [
      makeOrder({
        id: 1,
        order_nr: 'ORD-2026-2058',
        bundel_zending_nr: 'ZEND-2026-0017',
        bundel_order_count: 1,
      }),
    ]
    const { result } = renderHook(() => useBundelGroupedOrders(orders))
    expect(result.current[0]).toMatchObject({ kind: 'solo' })
  })

  it('respecteert input-volgorde voor bundel-positie (eerste bundel-order bepaalt positie)', () => {
    const orders = [
      makeOrder({ id: 1, order_nr: 'ORD-2026-2050' }),
      makeOrder({
        id: 2,
        order_nr: 'ORD-2026-2058',
        bundel_zending_nr: 'ZEND-2026-0017',
        bundel_order_count: 2,
      }),
      makeOrder({
        id: 3,
        order_nr: 'ORD-2026-2057',
        bundel_zending_nr: 'ZEND-2026-0017',
        bundel_order_count: 2,
      }),
      makeOrder({ id: 4, order_nr: 'ORD-2026-2056' }),
    ]
    const { result } = renderHook(() => useBundelGroupedOrders(orders))
    expect(result.current).toHaveLength(3)
    expect(result.current[0]).toMatchObject({ kind: 'solo' })
    expect(result.current[1]).toMatchObject({ kind: 'bundel' })
    expect(result.current[2]).toMatchObject({ kind: 'solo' })
  })
})
