import { describe, it, expect } from 'vitest'
import { isLeverweekTeBevestigen, vergelijkLeverweek } from '../edi-leverweek'

describe('isLeverweekTeBevestigen', () => {
  it('is true voor een EDI-order zonder edi_bevestigd_op', () => {
    expect(isLeverweekTeBevestigen({ bron_systeem: 'edi', edi_bevestigd_op: null })).toBe(true)
  })

  it('is false zodra een EDI-order bevestigd is', () => {
    expect(
      isLeverweekTeBevestigen({ bron_systeem: 'edi', edi_bevestigd_op: '2026-06-04T10:00:00Z' }),
    ).toBe(false)
  })

  it('is false voor niet-EDI-orders, ook zonder bevestiging', () => {
    expect(isLeverweekTeBevestigen({ bron_systeem: null, edi_bevestigd_op: null })).toBe(false)
    expect(isLeverweekTeBevestigen({ bron_systeem: 'lightspeed', edi_bevestigd_op: null })).toBe(
      false,
    )
  })
})

describe('vergelijkLeverweek', () => {
  it('meldt "gelijk" als gewenst en haalbaar in dezelfde ISO-week vallen', () => {
    const r = vergelijkLeverweek('2026-06-25', '2026-06-22') // beide week 26
    expect(r.relatie).toBe('gelijk')
    expect(r.weken).toBe(0)
  })

  it('meldt "later" met aantal weken als haalbaar later valt dan gewenst', () => {
    const r = vergelijkLeverweek('2026-06-22', '2026-07-06') // week 26 vs 28
    expect(r.relatie).toBe('later')
    expect(r.weken).toBe(2)
  })

  it('meldt "eerder" als haalbaar vóór de wens valt', () => {
    const r = vergelijkLeverweek('2026-07-06', '2026-06-22')
    expect(r.relatie).toBe('eerder')
    expect(r.weken).toBe(2)
  })

  it('telt over de jaarwisseling correct: wk53-2026 → wk1-2027 is 1 week later', () => {
    const r = vergelijkLeverweek('2026-12-28', '2027-01-04') // wk53-2026 vs wk1-2027
    expect(r.relatie).toBe('later')
    expect(r.weken).toBe(1)
  })

  it('geeft relatie "onbekend" als een van beide datums ontbreekt', () => {
    expect(vergelijkLeverweek(null, '2026-06-22').relatie).toBe('onbekend')
    expect(vergelijkLeverweek('2026-06-22', null).relatie).toBe('onbekend')
  })
})
