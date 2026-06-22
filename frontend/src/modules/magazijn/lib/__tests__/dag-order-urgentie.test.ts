import { describe, it, expect } from 'vitest'
import { bepaalDagOrderUrgentie } from '../dag-order-urgentie'

const VANDAAG = new Date('2026-06-25T10:00:00')

describe('bepaalDagOrderUrgentie', () => {
  it("geeft 'vandaag' als de afleverdatum in de toekomst ligt", () => {
    expect(bepaalDagOrderUrgentie('2026-06-26', VANDAAG)).toBe('vandaag')
  })

  it("geeft 'vandaag' als de afleverdatum exact vandaag is", () => {
    expect(bepaalDagOrderUrgentie('2026-06-25', VANDAAG)).toBe('vandaag')
  })

  it("geeft 'te_laat' als de afleverdatum al verstreken is", () => {
    expect(bepaalDagOrderUrgentie('2026-06-24', VANDAAG)).toBe('te_laat')
    expect(bepaalDagOrderUrgentie('2026-01-01', VANDAAG)).toBe('te_laat')
  })

  it('gebruikt new Date() als default zonder te crashen', () => {
    expect(['vandaag', 'te_laat']).toContain(bepaalDagOrderUrgentie('2099-01-01'))
  })
})
