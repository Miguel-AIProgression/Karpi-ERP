import { describe, it, expect } from 'vitest'
import { bucketVoor } from '../pick-ship-buckets'

describe('bucketVoor', () => {
  // Vaste referentiedatum: woensdag 2026-05-06 (ISO-week 19, 2026)
  const vandaag = new Date('2026-05-06T12:00:00Z')

  it('NULL afleverdatum -> geen_datum', () => {
    expect(bucketVoor(null, vandaag)).toBe('geen_datum')
  })

  it('afleverdatum gisteren -> achterstallig', () => {
    expect(bucketVoor('2026-05-05', vandaag)).toBe('achterstallig')
  })

  it('afleverdatum vandaag -> vandaag', () => {
    expect(bucketVoor('2026-05-06', vandaag)).toBe('vandaag')
  })

  it('afleverdatum morgen -> morgen', () => {
    expect(bucketVoor('2026-05-07', vandaag)).toBe('morgen')
  })

  it('afleverdatum vrijdag deze week -> deze_week', () => {
    expect(bucketVoor('2026-05-08', vandaag)).toBe('deze_week')
  })

  it('afleverdatum zondag deze week (einde ISO-week) -> deze_week', () => {
    expect(bucketVoor('2026-05-10', vandaag)).toBe('deze_week')
  })

  it('afleverdatum maandag volgende week -> volgende_week', () => {
    expect(bucketVoor('2026-05-11', vandaag)).toBe('volgende_week')
  })

  it('afleverdatum zondag volgende week -> volgende_week', () => {
    expect(bucketVoor('2026-05-17', vandaag)).toBe('volgende_week')
  })

  it('afleverdatum over 2 weken -> later', () => {
    expect(bucketVoor('2026-05-20', vandaag)).toBe('later')
  })

  it('jaarwisseling: vandaag = 2026-12-30 (wo, ISO-week 53), 2027-01-04 -> volgende_week', () => {
    const jaarwissel = new Date('2026-12-30T12:00:00Z')
    expect(bucketVoor('2027-01-04', jaarwissel)).toBe('volgende_week')
  })
})
