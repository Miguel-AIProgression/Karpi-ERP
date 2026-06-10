import { describe, it, expect } from 'vitest'
import { bouwOrderCommit, isGemengdeSplit } from '../order-commit'
import { ORDER_COMMIT_GOLDENS } from './order-commit.fixtures'

describe('bouwOrderCommit — golden fixtures (gedragsbehoud create-flow)', () => {
  for (const golden of ORDER_COMMIT_GOLDENS) {
    it(golden.naam, () => {
      // toEqual (niet toStrictEqual): de oude code zet bewust `id: undefined`
      // op IO-regels uit een gemengde dekking-split; fixtures laten die key weg.
      expect(bouwOrderCommit(golden.input)).toEqual(golden.verwacht)
    })
  }
})

describe('isGemengdeSplit', () => {
  it('alleen true als deelleveringen-checkbox AAN én order gemengd is', () => {
    expect(isGemengdeSplit(true, true)).toBe(true)
    expect(isGemengdeSplit(true, false)).toBe(false)
    expect(isGemengdeSplit(false, true)).toBe(false)
    expect(isGemengdeSplit(false, false)).toBe(false)
  })
})

describe('bouwOrderCommit — structuurgaranties', () => {
  it('muteert de input niet (pure functie)', () => {
    const golden = ORDER_COMMIT_GOLDENS[1] // IO-split: het meest mutatie-gevoelige pad
    const kopie = structuredClone(golden.input)
    bouwOrderCommit(golden.input)
    expect(golden.input).toEqual(kopie)
  })

  it('gesplitst=true impliceert exact 2 orders, gesplitst=false exact 1', () => {
    for (const golden of ORDER_COMMIT_GOLDENS) {
      const plan = bouwOrderCommit(golden.input)
      expect(plan.orders).toHaveLength(plan.gesplitst ? 2 : 1)
    }
  })
})
