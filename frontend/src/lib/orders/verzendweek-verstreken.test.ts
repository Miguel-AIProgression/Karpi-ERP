import { describe, it, expect } from 'vitest'
import { isVerzendweekVerstreken } from './verzendweek-verstreken'

const TODAY = '2026-06-28'

describe('isVerzendweekVerstreken', () => {
  it('order met afleverdatum in het verleden en open status = verstreken', () => {
    expect(isVerzendweekVerstreken({ afleverdatum: '2026-06-20', status: 'Klaar voor picken' }, TODAY)).toBe(true)
  })

  it('order van vandaag is nog niet over tijd', () => {
    expect(isVerzendweekVerstreken({ afleverdatum: TODAY, status: 'Klaar voor picken' }, TODAY)).toBe(false)
  })

  it('order in de toekomst is niet verstreken', () => {
    expect(isVerzendweekVerstreken({ afleverdatum: '2026-07-10', status: 'Klaar voor picken' }, TODAY)).toBe(false)
  })

  it('al (deels) verzonden of geannuleerd telt niet', () => {
    expect(isVerzendweekVerstreken({ afleverdatum: '2026-06-20', status: 'Verzonden' }, TODAY)).toBe(false)
    expect(isVerzendweekVerstreken({ afleverdatum: '2026-06-20', status: 'Deels verzonden' }, TODAY)).toBe(false)
    expect(isVerzendweekVerstreken({ afleverdatum: '2026-06-20', status: 'Geannuleerd' }, TODAY)).toBe(false)
  })

  it('oud_systeem telt niet mee', () => {
    expect(isVerzendweekVerstreken({ afleverdatum: '2026-06-20', status: 'Klaar voor picken', bron_systeem: 'oud_systeem' }, TODAY)).toBe(false)
  })

  it('zonder afleverdatum (geen verzendweek) telt niet hier', () => {
    expect(isVerzendweekVerstreken({ afleverdatum: null, status: 'Klaar voor picken' }, TODAY)).toBe(false)
  })
})
