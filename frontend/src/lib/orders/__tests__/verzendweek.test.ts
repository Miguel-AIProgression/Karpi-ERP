import { describe, it, expect } from 'vitest'
import {
  isoWeek,
  verzendWeekVoor,
  verzendWeekSleutel,
  verzendWeekLabel,
  verzendWeekKort,
  verzendWeekIsoString,
  verzendWeekStringToDatum,
  verzendWeekRelatief,
  pickWeekVoor,
  pickWeekLabel,
  pickStatusVoor,
  verzendWeekAchterstallig,
} from '../verzendweek'

describe('isoWeek', () => {
  it('woensdag 2026-05-06 -> week 19, jaar 2026', () => {
    expect(isoWeek(new Date('2026-05-06T12:00:00Z'))).toEqual({ jaar: 2026, week: 19 })
  })

  it('zondag 2026-12-27 hoort nog bij ISO-week 52 van 2026', () => {
    expect(isoWeek(new Date('2026-12-27T12:00:00Z'))).toEqual({ jaar: 2026, week: 52 })
  })

  it('maandag 2027-01-04 -> week 1 van 2027', () => {
    expect(isoWeek(new Date('2027-01-04T12:00:00Z'))).toEqual({ jaar: 2027, week: 1 })
  })
})

describe('verzendWeekVoor', () => {
  it('null -> null', () => {
    expect(verzendWeekVoor(null)).toBeNull()
  })

  it('2026-05-06 -> jaar 2026, week 19', () => {
    expect(verzendWeekVoor('2026-05-06')).toEqual({ jaar: 2026, week: 19 })
  })
})

describe('verzendWeekSleutel', () => {
  it('null -> 9999-W99 (sorteert achteraan)', () => {
    expect(verzendWeekSleutel(null)).toBe('9999-W99')
  })

  it('2026-05-06 -> 2026-W19', () => {
    expect(verzendWeekSleutel('2026-05-06')).toBe('2026-W19')
  })

  it('2027-01-04 -> 2027-W01 (zero-padded)', () => {
    expect(verzendWeekSleutel('2027-01-04')).toBe('2027-W01')
  })
})

describe('verzendWeekLabel', () => {
  it('null -> Geen datum', () => {
    expect(verzendWeekLabel(null)).toBe('Geen datum')
  })

  it('2026-05-06 -> Verzendweek 19', () => {
    expect(verzendWeekLabel('2026-05-06')).toBe('Verzendweek 19')
  })
})

describe('verzendWeekKort', () => {
  it('null -> Geen datum', () => {
    expect(verzendWeekKort(null)).toBe('Geen datum')
  })

  it('2026-05-06 -> Wk 19', () => {
    expect(verzendWeekKort('2026-05-06')).toBe('Wk 19')
  })
})

describe('verzendWeekIsoString', () => {
  it('null -> lege string (bind-baar aan input)', () => {
    expect(verzendWeekIsoString(null)).toBe('')
  })

  it('2026-05-06 -> 2026-W19', () => {
    expect(verzendWeekIsoString('2026-05-06')).toBe('2026-W19')
  })

  it('2027-01-04 -> 2027-W01 (zero-padded)', () => {
    expect(verzendWeekIsoString('2027-01-04')).toBe('2027-W01')
  })
})

describe('verzendWeekStringToDatum', () => {
  it('lege string -> null', () => {
    expect(verzendWeekStringToDatum('')).toBeNull()
  })

  it('ongeldig formaat -> null', () => {
    expect(verzendWeekStringToDatum('2026-21')).toBeNull()
    expect(verzendWeekStringToDatum('week 21')).toBeNull()
  })

  it('week buiten bereik -> null', () => {
    expect(verzendWeekStringToDatum('2026-W00')).toBeNull()
    expect(verzendWeekStringToDatum('2026-W54')).toBeNull()
  })

  it('2026-W19 -> vrijdag 2026-05-08', () => {
    expect(verzendWeekStringToDatum('2026-W19')).toBe('2026-05-08')
  })

  it('2026-W21 -> vrijdag 2026-05-22', () => {
    expect(verzendWeekStringToDatum('2026-W21')).toBe('2026-05-22')
  })

  it('rond reizen: ISO-week van retourdatum gelijk aan input', () => {
    const datum = verzendWeekStringToDatum('2026-W21')!
    expect(verzendWeekIsoString(datum)).toBe('2026-W21')
  })

  it('jaarwissel: 2027-W01 -> vrijdag 2027-01-08', () => {
    expect(verzendWeekStringToDatum('2027-W01')).toBe('2027-01-08')
  })
})

describe('verzendWeekRelatief', () => {
  // Vaste referentie: woensdag 2026-05-06 (ISO-week 19, 2026)
  const vandaag = new Date('2026-05-06T12:00:00Z')

  it('null afleverdatum -> null', () => {
    expect(verzendWeekRelatief(null, vandaag)).toBeNull()
  })

  it('andere dag in dezelfde week -> deze week', () => {
    expect(verzendWeekRelatief('2026-05-08', vandaag)).toBe('deze week')
  })

  it('vrijdag van volgende week -> volgende week', () => {
    expect(verzendWeekRelatief('2026-05-15', vandaag)).toBe('volgende week')
  })

  it('week 21 (over 2 weken) -> over 2 weken', () => {
    expect(verzendWeekRelatief('2026-05-22', vandaag)).toBe('over 2 weken')
  })

  it('vorige week -> 1 week geleden (enkelvoud)', () => {
    expect(verzendWeekRelatief('2026-04-30', vandaag)).toBe('1 week geleden')
  })

  it('drie weken terug -> 3 weken geleden (meervoud)', () => {
    expect(verzendWeekRelatief('2026-04-15', vandaag)).toBe('3 weken geleden')
  })
})

describe('pickWeekVoor', () => {
  it('null -> null', () => {
    expect(pickWeekVoor(null)).toBeNull()
  })

  it('verzendweek 21 (2026-05-22) -> pick-week 20 in 2026', () => {
    expect(pickWeekVoor('2026-05-22')).toEqual({ jaar: 2026, week: 20 })
  })

  it('verzendweek 1 van 2027 (2027-01-08) -> pick-week 53 van 2026', () => {
    // 2026 heeft een ISO-week 53 (begint 28-12-2026, want 2026-12-31 is een
    // donderdag). Helper moet correct het voorgaande jaar+week teruggeven.
    expect(pickWeekVoor('2027-01-08')).toEqual({ jaar: 2026, week: 53 })
  })
})

describe('pickWeekLabel', () => {
  it('null -> Geen datum', () => {
    expect(pickWeekLabel(null)).toBe('Geen datum')
  })

  it('verzendweek 21 -> "Te picken in week 20 · verzendweek 21"', () => {
    expect(pickWeekLabel('2026-05-22')).toBe('Te picken in week 20 · verzendweek 21')
  })
})

describe('pickStatusVoor', () => {
  // Vaste referentie: woensdag 2026-05-06 (ISO-week 19, 2026)
  // Pick-week = huidige ISO-week = 19. Op-tijd-grens dus:
  //   verzendweek 19 → pick-week 18 (vorig) → achterstallig
  //   verzendweek 20 → pick-week 19 (nu)   → deze_week
  //   verzendweek 21 → pick-week 20 (vlgd) → volgende_week
  //   verzendweek 22+ → later
  const vandaag = new Date('2026-05-06T12:00:00Z')

  it('null afleverdatum -> geen_datum', () => {
    expect(pickStatusVoor(null, vandaag)).toBe('geen_datum')
  })

  it('verzendweek = huidige week -> achterstallig (had vorige week gepickt moeten zijn)', () => {
    expect(pickStatusVoor('2026-05-08', vandaag)).toBe('achterstallig')
  })

  it('verzendweek 18 (al voorbij) -> achterstallig', () => {
    expect(pickStatusVoor('2026-04-30', vandaag)).toBe('achterstallig')
  })

  it('verzendweek = volgende week -> deze_week (pick-week == nu)', () => {
    expect(pickStatusVoor('2026-05-15', vandaag)).toBe('deze_week')
  })

  it('verzendweek 21 -> volgende_week', () => {
    expect(pickStatusVoor('2026-05-22', vandaag)).toBe('volgende_week')
  })

  it('verzendweek 22 -> later', () => {
    expect(pickStatusVoor('2026-05-29', vandaag)).toBe('later')
  })
})

describe('verzendWeekAchterstallig', () => {
  // Zelfde referentie als pickStatusVoor hierboven — bewust een ANDER
  // criterium: de verzendweek zelf, niet de pick-week. Bugmelding Miguel
  // 01-07: een order met verzendweek == huidige week is nog op tijd (moet
  // deze week nog verzonden worden), ook al zegt pickStatusVoor 'achterstallig'
  // (die kijkt naar de 1-week-vooruit-pickbuffer).
  const vandaag = new Date('2026-05-06T12:00:00Z') // ISO-week 19, 2026

  it('null afleverdatum -> false', () => {
    expect(verzendWeekAchterstallig(null, vandaag)).toBe(false)
  })

  it('verzendweek = huidige week -> NIET achterstallig (in tegenstelling tot pickStatusVoor)', () => {
    expect(verzendWeekAchterstallig('2026-05-08', vandaag)).toBe(false)
  })

  it('verzendweek 18 (al voorbij) -> achterstallig', () => {
    expect(verzendWeekAchterstallig('2026-04-30', vandaag)).toBe(true)
  })

  it('verzendweek = volgende week -> niet achterstallig', () => {
    expect(verzendWeekAchterstallig('2026-05-15', vandaag)).toBe(false)
  })
})
