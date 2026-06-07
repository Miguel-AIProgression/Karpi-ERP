import { describe, it, expect } from 'vitest'
import {
  isoWeekJaar,
  isoWeek,
  isoWeekString,
  isoWeekMaandag,
  maandagVanIsoWeek,
  isoWeekRange,
  isoWeekJaarVanIso,
  isoWeekStringVanIso,
  isoWeekFromString,
  lokaleDatumAlsUtc,
} from '../iso-week'

const utcSlice = (d: Date) => d.toISOString().slice(0, 10)

describe('isoWeekJaar', () => {
  it('woensdag 2026-05-06 -> week 19, jaar 2026', () => {
    expect(isoWeekJaar(new Date('2026-05-06T12:00:00Z'))).toEqual({ jaar: 2026, week: 19 })
  })

  it('jaargrens: zondag 2026-12-27 hoort nog bij week 52 van 2026', () => {
    expect(isoWeekJaar(new Date('2026-12-27T12:00:00Z'))).toEqual({ jaar: 2026, week: 52 })
  })

  it('jaargrens: maandag 2027-01-04 -> week 1 van 2027', () => {
    expect(isoWeekJaar(new Date('2027-01-04T12:00:00Z'))).toEqual({ jaar: 2027, week: 1 })
  })

  it('donderdag-regel: 2026-12-31 hoort bij ISO-jaar 2026 (week 53)', () => {
    expect(isoWeekJaar(new Date('2026-12-31T12:00:00Z'))).toEqual({ jaar: 2026, week: 53 })
  })

  it('donderdag-regel: 2024-12-31 (di) hoort bij ISO-jaar 2025 (week 1)', () => {
    expect(isoWeekJaar(new Date('2024-12-31T12:00:00Z'))).toEqual({ jaar: 2025, week: 1 })
  })
})

describe('week 53', () => {
  it('2026 heeft een ISO-week 53 (2026-12-31 is een donderdag)', () => {
    // Vrijdag 2027-01-01 valt nog in week 53 van ISO-jaar 2026.
    expect(isoWeekJaar(new Date('2027-01-01T12:00:00Z'))).toEqual({ jaar: 2026, week: 53 })
  })
})

describe('isoWeek', () => {
  it('geeft alleen het weeknummer', () => {
    expect(isoWeek(new Date('2026-05-06T12:00:00Z'))).toBe(19)
  })
})

describe('isoWeekString — padding & SQL-pariteit', () => {
  // Vaste set: verwachte "YYYY-Www" == to_char(date,'IYYY')||'-W'||to_char(date,'IW').
  const cases: Array<[string, string]> = [
    ['2026-01-01', '2026-W01'], // donderdag → week 1, zero-padded
    ['2025-12-29', '2026-W01'], // maandag van week 1/2026 ligt in dec 2025
    ['2026-04-20', '2026-W17'], // padding van enkelcijferige... nee, 17; controle midden-jaar
    ['2026-01-12', '2026-W03'], // week 3 → zero-padded "W03"
    ['2026-12-31', '2026-W53'], // week 53
    ['2027-01-01', '2026-W53'], // vrijdag, nog ISO-jaar 2026
    ['2024-12-31', '2025-W01'], // di → ISO-jaar 2025
  ]
  for (const [datum, verwacht] of cases) {
    it(`${datum} -> ${verwacht}`, () => {
      expect(isoWeekString(new Date(`${datum}T12:00:00Z`))).toBe(verwacht)
    })
  }
})

describe('TZ-robuustheid', () => {
  it('dezelfde kalenderdatum om 00:00Z en 23:00Z geeft hetzelfde weeknummer', () => {
    expect(isoWeek(new Date('2026-05-06T00:00:00Z'))).toBe(
      isoWeek(new Date('2026-05-06T23:00:00Z')),
    )
  })

  it('isoWeekJaarVanIso negeert tijd: kale datum is TZ-onafhankelijk verankerd', () => {
    expect(isoWeekJaarVanIso('2027-01-04')).toEqual({ jaar: 2027, week: 1 })
    expect(isoWeekJaarVanIso('2026-12-31')).toEqual({ jaar: 2026, week: 53 })
  })
})

describe('isoWeekMaandag', () => {
  it('maandag van week 19/2026 = 2026-05-04 (UTC-midnacht)', () => {
    expect(utcSlice(isoWeekMaandag(new Date('2026-05-06T12:00:00Z')))).toBe('2026-05-04')
  })

  it('zondag valt nog in dezelfde ISO-week', () => {
    expect(utcSlice(isoWeekMaandag(new Date('2026-05-10T12:00:00Z')))).toBe('2026-05-04')
  })
})

describe('maandagVanIsoWeek', () => {
  it('week 1 2026 = 2025-12-29 (spiegelt SQL/edge maandagVanWeek)', () => {
    expect(utcSlice(maandagVanIsoWeek(2026, 1))).toBe('2025-12-29')
  })

  it('week 17 2026 = 2026-04-20', () => {
    expect(utcSlice(maandagVanIsoWeek(2026, 17))).toBe('2026-04-20')
  })

  it('inverse van isoWeekJaar over jaargrens', () => {
    const ma = maandagVanIsoWeek(2026, 53)
    expect(isoWeekJaar(ma)).toEqual({ jaar: 2026, week: 53 })
  })
})

describe('isoWeekRange', () => {
  it('(2026, 19) -> maandag 2026-05-04 t/m zondag 2026-05-10', () => {
    const { van, tot } = isoWeekRange(2026, 19)
    expect(utcSlice(van)).toBe('2026-05-04')
    expect(utcSlice(tot)).toBe('2026-05-10')
  })
})

describe('lokaleDatumAlsUtc — wall-clock "nu" verankeren', () => {
  // Lokaal-geconstrueerde datums geven exact hun lokale componenten terug,
  // ongeacht de runner-tijdzone → deze test is deterministisch.
  it('verankert de LOKALE kalenderdatum op UTC-midnacht', () => {
    const ochtend = new Date(2026, 5, 8, 0, 30) // lokaal ma 08-06-2026 00:30
    expect(lokaleDatumAlsUtc(ochtend).toISOString().slice(0, 10)).toBe('2026-06-08')
  })

  it('is tijd-van-de-dag-onafhankelijk binnen dezelfde lokale dag', () => {
    const ochtend = new Date(2026, 5, 8, 0, 30)
    const avond = new Date(2026, 5, 8, 23, 30)
    expect(isoWeek(lokaleDatumAlsUtc(ochtend))).toBe(isoWeek(lokaleDatumAlsUtc(avond)))
  })
})

describe('string-helpers', () => {
  it('isoWeekStringVanIso: kale datum -> "YYYY-Www"', () => {
    expect(isoWeekStringVanIso('2026-05-06')).toBe('2026-W19')
  })

  it('isoWeekStringVanIso: null/leeg -> null', () => {
    expect(isoWeekStringVanIso(null)).toBeNull()
    expect(isoWeekStringVanIso(undefined)).toBeNull()
  })

  it('isoWeekFromString: geeft enkel weeknummer als string (backwards-compat)', () => {
    expect(isoWeekFromString('2026-05-06')).toBe('19')
  })

  it('isoWeekFromString: null -> null', () => {
    expect(isoWeekFromString(null)).toBeNull()
  })
})
