import { describe, expect, it } from 'vitest'
import {
  dropshipAflEmailProbleem,
  isBlokkerendDropshipEmailProbleem,
} from '../dropship-email'

describe('dropshipAflEmailProbleem', () => {
  it('meldt ontbreekt bij leeg/null/whitespace afl_email', () => {
    expect(dropshipAflEmailProbleem({ aflEmail: null, factEmail: 'f@k.nl' })).toBe('ontbreekt')
    expect(dropshipAflEmailProbleem({ aflEmail: '', factEmail: 'f@k.nl' })).toBe('ontbreekt')
    expect(dropshipAflEmailProbleem({ aflEmail: '   ', factEmail: 'f@k.nl' })).toBe('ontbreekt')
  })

  it('meldt gelijk_aan_factuur — case- en whitespace-ongevoelig', () => {
    expect(
      dropshipAflEmailProbleem({ aflEmail: ' Info@Winkel.NL ', factEmail: 'info@winkel.nl' }),
    ).toBe('gelijk_aan_factuur')
  })

  it('meldt gelijk_aan_debiteur voor elk debiteur-e-mailadres', () => {
    expect(
      dropshipAflEmailProbleem({
        aflEmail: 'verkoop@winkel.nl',
        factEmail: 'facturen@winkel.nl',
        debiteurEmails: ['facturen@winkel.nl', 'VERKOOP@winkel.nl'],
      }),
    ).toBe('gelijk_aan_debiteur')
  })

  it('keurt een afwijkend consument-adres goed', () => {
    expect(
      dropshipAflEmailProbleem({
        aflEmail: 'consument@gmail.com',
        factEmail: 'facturen@winkel.nl',
        debiteurEmails: ['facturen@winkel.nl', 'verkoop@winkel.nl'],
      }),
    ).toBeNull()
  })

  it('matcht een leeg factuur-/debiteur-adres nooit tegen een gevuld afl_email', () => {
    expect(
      dropshipAflEmailProbleem({
        aflEmail: 'consument@gmail.com',
        factEmail: null,
        debiteurEmails: [null, '', undefined],
      }),
    ).toBeNull()
  })
})

describe('isBlokkerendDropshipEmailProbleem', () => {
  it('blokkeert alleen op gelijk-aan, niet op ontbreekt', () => {
    expect(isBlokkerendDropshipEmailProbleem('gelijk_aan_factuur')).toBe(true)
    expect(isBlokkerendDropshipEmailProbleem('gelijk_aan_debiteur')).toBe(true)
    expect(isBlokkerendDropshipEmailProbleem('ontbreekt')).toBe(false)
    expect(isBlokkerendDropshipEmailProbleem(null)).toBe(false)
  })
})
