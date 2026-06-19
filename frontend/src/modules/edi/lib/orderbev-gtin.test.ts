import { describe, it, expect } from 'vitest'
import { extractBerichtRegels, maakBerichtGtinResolver } from './orderbev-gtin'

describe('extractBerichtRegels', () => {
  it('leest regels uit de bevestig-flow vorm (payload.regels)', () => {
    const payload = {
      regels: [
        { regelnummer: 1, gtin: '8715954000017' },
        { regelnummer: 2, gtin: '8715954000024' },
      ],
    }
    expect(extractBerichtRegels(payload)).toEqual([
      { regelnummer: 1, gtin: '8715954000017' },
      { regelnummer: 2, gtin: '8715954000024' },
    ])
  })

  it('leest regels uit de download-flow vorm (payload.source.regels)', () => {
    const payload = {
      format: 'transus_xml',
      source: { regels: [{ regelnummer: 5, gtin: '8715954000031' }] },
    }
    expect(extractBerichtRegels(payload)).toEqual([{ regelnummer: 5, gtin: '8715954000031' }])
  })

  it('trimt GTIN en valt terug op 0/"" bij ontbrekende velden', () => {
    const payload = { regels: [{ gtin: '  8715954000048  ' }, { regelnummer: 'x' }] }
    expect(extractBerichtRegels(payload)).toEqual([
      { regelnummer: 0, gtin: '8715954000048' },
      { regelnummer: 0, gtin: '' },
    ])
  })

  it('geeft lege lijst bij null/lege payload', () => {
    expect(extractBerichtRegels(null)).toEqual([])
    expect(extractBerichtRegels(undefined)).toEqual([])
    expect(extractBerichtRegels({})).toEqual([])
  })
})

describe('maakBerichtGtinResolver', () => {
  it('koppelt op regelnummer (Hornbach-case: GTIN in bericht, ean_code leeg)', () => {
    const payload = {
      regels: [
        { regelnummer: 1, gtin: '8715954000017' },
        { regelnummer: 2, gtin: '8715954000024' },
      ],
    }
    const resolve = maakBerichtGtinResolver(payload, 2)
    expect(resolve(1, 0)).toBe('8715954000017')
    expect(resolve(2, 1)).toBe('8715954000024')
  })

  it('valt terug op positie-index als regelnummers niet matchen maar de aantallen gelijk zijn', () => {
    // Partner gebruikt regelnummers 10/20; DB-regels zijn 1/2.
    const payload = {
      regels: [
        { regelnummer: 10, gtin: '8715954000017' },
        { regelnummer: 20, gtin: '8715954000024' },
      ],
    }
    const resolve = maakBerichtGtinResolver(payload, 2)
    expect(resolve(1, 0)).toBe('8715954000017')
    expect(resolve(2, 1)).toBe('8715954000024')
  })

  it('gebruikt GEEN index-fallback als de aantallen verschillen (bewerkte order)', () => {
    const payload = { regels: [{ regelnummer: 99, gtin: '8715954000017' }] }
    const resolve = maakBerichtGtinResolver(payload, 2) // 1 bericht-regel, 2 DB-regels
    expect(resolve(1, 0)).toBe('') // geen nummer-match, geen index-fallback → caller pakt ean_code
  })

  it('negeert lege GTIN in het bericht zodat de caller naar ean_code valt', () => {
    const payload = { regels: [{ regelnummer: 1, gtin: '' }] }
    const resolve = maakBerichtGtinResolver(payload, 1)
    expect(resolve(1, 0)).toBe('')
  })

  it('geeft "" wanneer er geen bericht-regels zijn', () => {
    const resolve = maakBerichtGtinResolver(null, 1)
    expect(resolve(1, 0)).toBe('')
  })
})
