import { describe, it, expect } from 'vitest'
import { isDebiteurTeBevestigen, filterDebiteurTeBevestigen } from '../intake-predicaten'

describe('isDebiteurTeBevestigen', () => {
  it('true bij onzekere match die geen env_fallback is', () => {
    expect(isDebiteurTeBevestigen({ debiteur_zeker: false, debiteur_match_bron: 'naam_fuzzy', status: 'Klaar voor picken' })).toBe(true)
  })
  it('true bij onzekere match zonder vastgelegde bron (NULL-safe)', () => {
    expect(isDebiteurTeBevestigen({ debiteur_zeker: false, debiteur_match_bron: null, status: 'Klaar voor picken' })).toBe(true)
  })
  it('false bij env_fallback (verzameldebiteur = verwachte eindbestemming)', () => {
    expect(isDebiteurTeBevestigen({ debiteur_zeker: false, debiteur_match_bron: 'env_fallback', status: 'Klaar voor picken' })).toBe(false)
  })
  it('false bij zekere match', () => {
    expect(isDebiteurTeBevestigen({ debiteur_zeker: true, debiteur_match_bron: null, status: 'Klaar voor picken' })).toBe(false)
  })
  it('false bij geannuleerde order', () => {
    expect(isDebiteurTeBevestigen({ debiteur_zeker: false, debiteur_match_bron: 'naam_fuzzy', status: 'Geannuleerd' })).toBe(false)
  })
})

describe('filterDebiteurTeBevestigen', () => {
  it('past exact de drie PostgREST-filters toe', () => {
    const calls: { op: string; args: unknown[] }[] = []
    const q = {
      eq(c: string, v: unknown) { calls.push({ op: 'eq', args: [c, v] }); return this },
      or(f: string) { calls.push({ op: 'or', args: [f] }); return this },
      neq(c: string, v: unknown) { calls.push({ op: 'neq', args: [c, v] }); return this },
    }
    filterDebiteurTeBevestigen(q)
    expect(calls).toEqual([
      { op: 'eq', args: ['debiteur_zeker', false] },
      { op: 'or', args: ['debiteur_match_bron.is.null,debiteur_match_bron.neq.env_fallback'] },
      { op: 'neq', args: ['status', 'Geannuleerd'] },
    ])
  })
})
