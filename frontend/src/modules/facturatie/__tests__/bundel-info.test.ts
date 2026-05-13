import { describe, it, expect, vi, beforeEach } from 'vitest'

let nextResponse: any = { data: null, error: null }

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: any) => Promise.resolve(nextResponse),
      }),
    }),
  },
}))

import { fetchBundelInfoVoorFactuur } from '../queries/facturen'

beforeEach(() => {
  nextResponse = { data: null, error: null }
})

describe('fetchBundelInfoVoorFactuur', () => {
  it('returns isBundel=false voor solo-factuur (1 order, 1 VERZEND)', async () => {
    nextResponse = {
      data: [
        { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'SANDRO', bedrag: 200 },
        { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'VERZEND', bedrag: 35 },
      ],
      error: null,
    }
    const info = await fetchBundelInfoVoorFactuur(1)
    expect(info.isBundel).toBe(false)
    expect(info.heeftDrempelKorting).toBe(false)
    expect(info.andereOrders).toEqual([])
  })

  it('detecteert scenario A: drempel-bundel (N× VERZEND + BUNDELKORTING + DREMPELKORTING)', async () => {
    nextResponse = {
      data: [
        { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'SANDRO', bedrag: 200 },
        { order_id: 101, order_nr: 'ORD-2026-0101', artikelnr: 'SANDRO', bedrag: 300 },
        { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'VERZEND', bedrag: 35 },
        { order_id: 101, order_nr: 'ORD-2026-0101', artikelnr: 'VERZEND', bedrag: 35 },
        { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'BUNDELKORTING', bedrag: -35 },
        { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'DREMPELKORTING', bedrag: -35 },
      ],
      error: null,
    }
    const info = await fetchBundelInfoVoorFactuur(1)
    expect(info.isBundel).toBe(true)
    expect(info.heeftDrempelKorting).toBe(true)
    expect(info.verzendkostenTotaal).toBe(70) // 2 × 35
    expect(info.bundelKortingBedrag).toBe(35) // (2-1) × 35
    expect(info.drempelKortingBedrag).toBe(35) // 1 × 35
    expect(info.andereOrders).toHaveLength(2)
    expect(info.andereOrders.map((o) => o.id).sort()).toEqual([100, 101])
  })

  it('detecteert scenario B: bundel zonder drempel (N× VERZEND + BUNDELKORTING, GEEN DREMPELKORTING)', async () => {
    nextResponse = {
      data: [
        { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'SANDRO', bedrag: 100 },
        { order_id: 101, order_nr: 'ORD-2026-0101', artikelnr: 'SANDRO', bedrag: 100 },
        { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'VERZEND', bedrag: 35 },
        { order_id: 101, order_nr: 'ORD-2026-0101', artikelnr: 'VERZEND', bedrag: 35 },
        { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'BUNDELKORTING', bedrag: -35 },
      ],
      error: null,
    }
    const info = await fetchBundelInfoVoorFactuur(1)
    expect(info.isBundel).toBe(true)
    expect(info.heeftDrempelKorting).toBe(false)
    expect(info.verzendkostenTotaal).toBe(70)
    expect(info.bundelKortingBedrag).toBe(35)
    expect(info.drempelKortingBedrag).toBe(0)
    expect(info.andereOrders).toHaveLength(2)
  })

  it('handelt data=null correct (geen crash, isBundel=false)', async () => {
    nextResponse = { data: null, error: null }
    const info = await fetchBundelInfoVoorFactuur(999)
    expect(info.isBundel).toBe(false)
    expect(info.heeftDrempelKorting).toBe(false)
    expect(info.verzendkostenTotaal).toBe(0)
    expect(info.bundelKortingBedrag).toBe(0)
    expect(info.drempelKortingBedrag).toBe(0)
    expect(info.andereOrders).toEqual([])
  })

  it('detecteert legacy 2×VERZEND zonder BUNDELKORTING als GEEN bundel (V2-strict)', async () => {
    nextResponse = {
      data: [
        { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'SANDRO', bedrag: 200 },
        { order_id: 101, order_nr: 'ORD-2026-0101', artikelnr: 'SANDRO', bedrag: 300 },
        { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'VERZEND', bedrag: 35 },
        { order_id: 101, order_nr: 'ORD-2026-0101', artikelnr: 'VERZEND', bedrag: 35 },
      ],
      error: null,
    }
    const info = await fetchBundelInfoVoorFactuur(1)
    expect(info.isBundel).toBe(false)
    expect(info.andereOrders).toEqual([])
  })
})
