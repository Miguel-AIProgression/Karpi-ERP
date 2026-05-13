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

  it('detecteert scenario A: multi-order met BUNDELKORTING', async () => {
    nextResponse = {
      data: [
        { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'SANDRO', bedrag: 200 },
        { order_id: 101, order_nr: 'ORD-2026-0101', artikelnr: 'SANDRO', bedrag: 300 },
        { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'VERZEND', bedrag: 35 },
        { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'BUNDELKORTING', bedrag: -35 },
      ],
      error: null,
    }
    const info = await fetchBundelInfoVoorFactuur(1)
    expect(info.isBundel).toBe(true)
    expect(info.heeftDrempelKorting).toBe(true)
    expect(info.verzendkostenBedrag).toBe(35)
    expect(info.andereOrders).toHaveLength(2)
    expect(info.andereOrders.map((o) => o.id).sort()).toEqual([100, 101])
  })

  it('detecteert scenario B: multi-order zonder BUNDELKORTING', async () => {
    nextResponse = {
      data: [
        { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'SANDRO', bedrag: 100 },
        { order_id: 101, order_nr: 'ORD-2026-0101', artikelnr: 'SANDRO', bedrag: 100 },
        { order_id: 100, order_nr: 'ORD-2026-0100', artikelnr: 'VERZEND', bedrag: 35 },
      ],
      error: null,
    }
    const info = await fetchBundelInfoVoorFactuur(1)
    expect(info.isBundel).toBe(true)
    expect(info.heeftDrempelKorting).toBe(false)
    expect(info.verzendkostenBedrag).toBe(35)
    expect(info.andereOrders).toHaveLength(2)
  })
})
