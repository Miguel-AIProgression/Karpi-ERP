import { describe, it, expect } from 'vitest'
import { printsetPadVoorZendingen } from './printset-navigatie'

describe('printsetPadVoorZendingen', () => {
  it('één zending → single-zending printset', () => {
    expect(printsetPadVoorZendingen([{ zending_nr: 'ZEND-2026-0042' }])).toBe(
      '/logistiek/ZEND-2026-0042/printset',
    )
  })

  it('meerdere zendingen → bulk-printset met comma-gescheiden, ge-encode query', () => {
    expect(
      printsetPadVoorZendingen([
        { zending_nr: 'ZEND-2026-0042' },
        { zending_nr: 'ZEND-2026-0043' },
      ]),
    ).toBe('/logistiek/printset/bulk?zendingen=ZEND-2026-0042%2CZEND-2026-0043')
  })
})
