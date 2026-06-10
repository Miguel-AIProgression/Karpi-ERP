import { describe, it, expect } from 'vitest'
import { parseEmailRecipients, splitEmailRecipients } from './email-recipients'

describe('splitEmailRecipients', () => {
  it('splitst op komma, puntkomma en whitespace', () => {
    expect(splitEmailRecipients('a@x.nl, b@y.nl; c@z.nl d@w.nl')).toEqual([
      'a@x.nl',
      'b@y.nl',
      'c@z.nl',
      'd@w.nl',
    ])
  })

  it('negeert lege stukken en losse whitespace', () => {
    expect(splitEmailRecipients('  a@x.nl ,, ; ')).toEqual(['a@x.nl'])
    expect(splitEmailRecipients('')).toEqual([])
  })
})

describe('parseEmailRecipients', () => {
  it('normaliseert naar komma-gescheiden string', () => {
    const r = parseEmailRecipients('a@x.nl  b@y.nl')
    expect(r.normalized).toBe('a@x.nl, b@y.nl')
    expect(r.invalid).toEqual([])
  })

  it('detecteert ongeldige adressen', () => {
    const r = parseEmailRecipients('a@x.nl, geen-email, b@y')
    expect(r.invalid).toEqual(['geen-email', 'b@y'])
  })

  it('lege invoer → lege normalized, geen invalid', () => {
    const r = parseEmailRecipients('')
    expect(r.normalized).toBe('')
    expect(r.invalid).toEqual([])
    expect(r.emails).toEqual([])
  })
})
