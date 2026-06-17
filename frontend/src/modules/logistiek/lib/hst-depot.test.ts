import { describe, it, expect } from 'vitest'
import { hstDepotVoorPostcode } from './hst-depot'

describe('hstDepotVoorPostcode', () => {
  it('bepaalt het NL-depot uit de eerste 4 cijfers van de postcode', () => {
    expect(hstDepotVoorPostcode('7122 LB', 'NL')).toBe('75') // Karpi zelf (Aalten)
    expect(hstDepotVoorPostcode('1012 AB', 'NL')).toBe('10')
    expect(hstDepotVoorPostcode('1013 ZZ', 'NL')).toBe('17')
    expect(hstDepotVoorPostcode('9999', 'NL')).toBe('98')
  })

  it('respecteert range-grenzen (inclusief)', () => {
    expect(hstDepotVoorPostcode('3749', 'NL')).toBe('39') // bovengrens [3700,3749]
    expect(hstDepotVoorPostcode('3750', 'NL')).toBe('74') // ondergrens [3750,3754]
  })

  it('gebruikt de BE-tabel bij een Belgische postcode', () => {
    expect(hstDepotVoorPostcode('1000', 'BE')).toBe('90')
    expect(hstDepotVoorPostcode('2000', 'BE')).toBe('20')
    expect(hstDepotVoorPostcode('9000', 'BE')).toBe('90')
  })

  it('kiest de juiste tabel per land voor dezelfde postcode', () => {
    // 3945 → NL [3900,3979]=39, BE [3945,3945]=30. Het land beslist.
    expect(hstDepotVoorPostcode('3945', 'NL')).toBe('39')
    expect(hstDepotVoorPostcode('3945', 'BE')).toBe('30')
  })

  it('normaliseert vrije landnamen via de gedeelde land-seam', () => {
    expect(hstDepotVoorPostcode('1012', 'Nederland')).toBe('10')
    expect(hstDepotVoorPostcode('1000', 'België')).toBe('90')
  })

  it('geeft null bij land buiten NL/BE', () => {
    expect(hstDepotVoorPostcode('40213', 'DE')).toBeNull()
    expect(hstDepotVoorPostcode('1000', 'Duitsland')).toBeNull()
  })

  it('geeft null bij ontbrekende of onleesbare postcode', () => {
    expect(hstDepotVoorPostcode(null, 'NL')).toBeNull()
    expect(hstDepotVoorPostcode('', 'NL')).toBeNull()
    expect(hstDepotVoorPostcode('AB', 'NL')).toBeNull()
    expect(hstDepotVoorPostcode('12', 'NL')).toBeNull()
  })

  it('geeft null bij ontbrekend land (geen aanname over depot)', () => {
    expect(hstDepotVoorPostcode('7122', null)).toBeNull()
  })
})
