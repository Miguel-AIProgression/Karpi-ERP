import { describe, it, expect } from 'vitest'
import { berekenRegelBedrag } from './bedrag'

describe('berekenRegelBedrag', () => {
  it('prijs × aantal zonder korting', () => {
    expect(berekenRegelBedrag(10, 3)).toBe(30)
  })

  it('past korting% toe en rondt op centen', () => {
    expect(berekenRegelBedrag(9.99, 3, 10)).toBe(26.97) // 29.97 × 0.9 = 26.973
  })

  it('korting default 0', () => {
    expect(berekenRegelBedrag(12.5, 2, 0)).toBe(25)
  })
})
