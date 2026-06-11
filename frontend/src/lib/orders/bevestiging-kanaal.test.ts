import { describe, expect, it } from 'vitest'
import { bepaalBevestigingKanaal, isOrderBevestigd } from './bevestiging-kanaal'

describe('bepaalBevestigingKanaal', () => {
  it('niet-EDI-order → email, ongeacht config', () => {
    expect(bepaalBevestigingKanaal(null, null)).toBe('email')
    expect(bepaalBevestigingKanaal(undefined, null)).toBe('email')
    expect(bepaalBevestigingKanaal('handmatig', null)).toBe('email')
    expect(
      bepaalBevestigingKanaal('shopify', { transus_actief: true, orderbev_uit: true }),
    ).toBe('email')
  })

  it('EDI-order met transus_actief én orderbev_uit → edi', () => {
    expect(
      bepaalBevestigingKanaal('edi', { transus_actief: true, orderbev_uit: true }),
    ).toBe('edi')
  })

  it('EDI-order zonder orderbev_uit, zonder actieve partner of zonder config → email (besluit 11-06)', () => {
    expect(
      bepaalBevestigingKanaal('edi', { transus_actief: true, orderbev_uit: false }),
    ).toBe('email')
    expect(
      bepaalBevestigingKanaal('edi', { transus_actief: false, orderbev_uit: true }),
    ).toBe('email')
    expect(bepaalBevestigingKanaal('edi', null)).toBe('email')
  })
})

describe('isOrderBevestigd (zonder kanaal — fallback-gedrag)', () => {
  it('EDI-order kijkt uitsluitend naar edi_bevestigd_op', () => {
    expect(
      isOrderBevestigd({ bron_systeem: 'edi', edi_bevestigd_op: '2026-06-11T10:00:00Z', bevestigd_at: null }),
    ).toBe(true)
    expect(
      isOrderBevestigd({ bron_systeem: 'edi', edi_bevestigd_op: null, bevestigd_at: '2026-06-11T10:00:00Z' }),
    ).toBe(false)
  })

  it('niet-EDI-order kijkt uitsluitend naar bevestigd_at', () => {
    expect(
      isOrderBevestigd({ bron_systeem: null, bevestigd_at: '2026-06-11T10:00:00Z', edi_bevestigd_op: null }),
    ).toBe(true)
    expect(
      isOrderBevestigd({ bron_systeem: 'handmatig', bevestigd_at: null, edi_bevestigd_op: null }),
    ).toBe(false)
  })
})

describe('isOrderBevestigd (met expliciet kanaal)', () => {
  it("kanaal 'edi' → kijkt uitsluitend naar edi_bevestigd_op", () => {
    expect(
      isOrderBevestigd(
        { bron_systeem: 'edi', edi_bevestigd_op: '2026-06-11T10:00:00Z', bevestigd_at: null },
        'edi',
      ),
    ).toBe(true)
    expect(
      isOrderBevestigd(
        { bron_systeem: 'edi', edi_bevestigd_op: null, bevestigd_at: '2026-06-11T10:00:00Z' },
        'edi',
      ),
    ).toBe(false)
  })

  it("kanaal 'email' + EDI-order → alleen bevestigd als bevestigd_at gezet is (mail verstuurd)", () => {
    // Alleen edi_bevestigd_op (leverweek-gate) gezet — nog NIET bevestigd via mail
    expect(
      isOrderBevestigd(
        { bron_systeem: 'edi', edi_bevestigd_op: '2026-06-11T10:00:00Z', bevestigd_at: null },
        'email',
      ),
    ).toBe(false)
    // bevestigd_at gezet (mail verstuurd) — wél bevestigd
    expect(
      isOrderBevestigd(
        { bron_systeem: 'edi', edi_bevestigd_op: null, bevestigd_at: '2026-06-11T10:00:00Z' },
        'email',
      ),
    ).toBe(true)
  })

  it("kanaal 'email' + niet-EDI-order → kijkt naar bevestigd_at", () => {
    expect(
      isOrderBevestigd(
        { bron_systeem: null, bevestigd_at: '2026-06-11T10:00:00Z', edi_bevestigd_op: null },
        'email',
      ),
    ).toBe(true)
    expect(
      isOrderBevestigd(
        { bron_systeem: 'handmatig', bevestigd_at: null, edi_bevestigd_op: null },
        'email',
      ),
    ).toBe(false)
  })
})
