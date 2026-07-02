import { describe, expect, it } from 'vitest'
import { isZendingGepland, isZendingLopend } from './zending-status'

describe('zending-status-predicaten (mig 477)', () => {
  it('Gepland = aangemaakt, nog niet gestart', () => {
    expect(isZendingGepland('Gepland')).toBe(true)
    expect(isZendingGepland('Picken')).toBe(false)
  })
  it('lopend = Gepland of Picken', () => {
    expect(isZendingLopend('Gepland')).toBe(true)
    expect(isZendingLopend('Picken')).toBe(true)
    expect(isZendingLopend('Klaar voor verzending')).toBe(false)
    expect(isZendingLopend(null)).toBe(false)
  })
})
