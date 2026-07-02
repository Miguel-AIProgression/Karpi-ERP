import { describe, expect, it, vi } from 'vitest'
import { fetchAllPaginated } from './paginate'

/** Fake PostgREST-bron: een array die per .range() een slice teruggeeft. */
function fakeSource(total: number) {
  const rows = Array.from({ length: total }, (_, i) => i)
  return vi.fn(async (from: number, to: number) => ({
    data: rows.slice(from, to + 1),
    error: null,
  }))
}

describe('fetchAllPaginated', () => {
  it('haalt alle rijen op, ook over de 1000-cap heen', async () => {
    const src = fakeSource(2350)
    const out = await fetchAllPaginated(src, 1000, 4)
    expect(out).toHaveLength(2350)
    expect(out[0]).toBe(0)
    expect(out[2349]).toBe(2349)
  })

  it('geen duplicaten of gaten bij exact-veelvoud', async () => {
    const out = await fetchAllPaginated(fakeSource(2000), 1000, 4)
    expect(out).toEqual(Array.from({ length: 2000 }, (_, i) => i))
  })

  it('één pagina als alles in de eerste batch past', async () => {
    const src = fakeSource(500)
    const out = await fetchAllPaginated(src, 1000, 4)
    expect(out).toHaveLength(500)
    // Eerste batch van 4 vuurt, maar pagina 0 is al niet-vol → klaar.
    expect(src).toHaveBeenCalledTimes(4)
  })

  it('gooit door bij een fout', async () => {
    const bad = vi.fn(async () => ({ data: null, error: new Error('boom') }))
    await expect(fetchAllPaginated(bad, 1000, 4)).rejects.toThrow('boom')
  })
})
