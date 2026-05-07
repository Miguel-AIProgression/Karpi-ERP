import { describe, it, expect } from 'vitest'
import { bucketVoor, genereerWeekTabs } from '../buckets'

describe('bucketVoor', () => {
  // Vaste referentiedatum: woensdag 2026-05-06 (ISO-week 19, 2026)
  // wk_1 = eerstvolgende verzendweek (week 20) + huidige + achterstallig.
  // wk_2..wk_5 = week 21..24. later = week 25+ of geen datum.
  const vandaag = new Date('2026-05-06T12:00:00Z')

  it('NULL afleverdatum -> later', () => {
    expect(bucketVoor(null, vandaag)).toBe('later')
  })

  it('afleverdatum gisteren (achterstallig) -> wk_1', () => {
    expect(bucketVoor('2026-05-05', vandaag)).toBe('wk_1')
  })

  it('afleverdatum vandaag (huidige verzendweek 19) -> wk_1', () => {
    expect(bucketVoor('2026-05-06', vandaag)).toBe('wk_1')
  })

  it('afleverdatum vrijdag deze week (verzendweek 19) -> wk_1', () => {
    expect(bucketVoor('2026-05-08', vandaag)).toBe('wk_1')
  })

  it('afleverdatum maandag week 20 -> wk_1', () => {
    expect(bucketVoor('2026-05-11', vandaag)).toBe('wk_1')
  })

  it('afleverdatum zondag week 20 -> wk_1', () => {
    expect(bucketVoor('2026-05-17', vandaag)).toBe('wk_1')
  })

  it('afleverdatum maandag week 21 -> wk_2', () => {
    expect(bucketVoor('2026-05-18', vandaag)).toBe('wk_2')
  })

  it('afleverdatum week 22 -> wk_3', () => {
    expect(bucketVoor('2026-05-27', vandaag)).toBe('wk_3')
  })

  it('afleverdatum week 23 -> wk_4', () => {
    expect(bucketVoor('2026-06-01', vandaag)).toBe('wk_4')
  })

  it('afleverdatum week 24 -> wk_5', () => {
    expect(bucketVoor('2026-06-08', vandaag)).toBe('wk_5')
  })

  it('afleverdatum week 25 -> later', () => {
    expect(bucketVoor('2026-06-15', vandaag)).toBe('later')
  })

  it('jaarwisseling: vandaag = 2026-12-30 (wo, ISO-week 53), 2027-01-04 (week 1) -> wk_1', () => {
    const jaarwissel = new Date('2026-12-30T12:00:00Z')
    expect(bucketVoor('2027-01-04', jaarwissel)).toBe('wk_1')
  })

  it('jaarwisseling: 5 weken vooruit valt nog binnen wk_5', () => {
    const jaarwissel = new Date('2026-12-30T12:00:00Z')
    // 5 weken na week 53/2026 = week 5/2027
    expect(bucketVoor('2027-02-01', jaarwissel)).toBe('wk_5')
  })
})

describe('genereerWeekTabs', () => {
  // Vaste referentiedatum: woensdag 2026-05-06 (ISO-week 19, 2026)
  const vandaag = new Date('2026-05-06T12:00:00Z')

  it('produceert 5 weektabs + later', () => {
    const tabs = genereerWeekTabs(vandaag)
    expect(tabs).toHaveLength(6)
    expect(tabs.map((t) => t.key)).toEqual([
      'wk_1', 'wk_2', 'wk_3', 'wk_4', 'wk_5', 'later',
    ])
  })

  it('eerste tab toont huidige pick-week (= week 19)', () => {
    const tabs = genereerWeekTabs(vandaag)
    expect(tabs[0].weeknr).toBe(19)
    expect(tabs[0].jaar).toBe(2026)
    expect(tabs[0].label).toBe('Week 19')
  })

  it('vijfde tab toont week 23 (huidig + 4)', () => {
    const tabs = genereerWeekTabs(vandaag)
    expect(tabs[4].weeknr).toBe(23)
    expect(tabs[4].label).toBe('Week 23')
  })

  it('later-tab heeft geen weeknr/jaar', () => {
    const tabs = genereerWeekTabs(vandaag)
    expect(tabs[5].key).toBe('later')
    expect(tabs[5].weeknr).toBeNull()
    expect(tabs[5].jaar).toBeNull()
    expect(tabs[5].label).toBe('Later')
  })

  it('jaarwisseling: vandaag = 2026-12-30 (week 53) → eerste tab = week 53/2026', () => {
    const jaarwissel = new Date('2026-12-30T12:00:00Z')
    const tabs = genereerWeekTabs(jaarwissel)
    expect(tabs[0].weeknr).toBe(53)
    expect(tabs[0].jaar).toBe(2026)
    expect(tabs[0].label).toBe('Week 53')
  })
})
