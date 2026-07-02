import { describe, it, expect } from 'vitest'
import { bouwOrderCommit, isGemengdeSplit } from '../order-commit'
import { ORDER_COMMIT_GOLDENS } from './order-commit.fixtures'
import { isVormToeslagRegel, maakVormToeslagRegel } from '../vorm-toeslag-regel'
import type { OrderCommitInput } from '../order-commit'
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'

describe('bouwOrderCommit — golden fixtures (gedragsbehoud create-flow)', () => {
  for (const golden of ORDER_COMMIT_GOLDENS) {
    it(golden.naam, () => {
      // Clone vooraf: input en verwacht delen bewust object-referenties,
      // dus zonder snapshot zou een in-place mutatie onzichtbaar blijven.
      const inputSnapshot = structuredClone(golden.input)
      // toEqual (niet toStrictEqual): de oude code zet bewust `id: undefined`
      // op IO-regels uit een gemengde dekking-split; fixtures laten die key weg.
      expect(bouwOrderCommit(golden.input)).toEqual(golden.verwacht)
      expect(golden.input).toEqual(inputSnapshot)
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
  it('gesplitst=true impliceert exact 2 orders, gesplitst=false exact 1', () => {
    for (const golden of ORDER_COMMIT_GOLDENS) {
      const plan = bouwOrderCommit(golden.input)
      expect(plan.orders).toHaveLength(plan.gesplitst ? 2 : 1)
    }
  })
})

// mig 465: VORMTOESLAG-companion is is_maatwerk=false maar via
// array-positie-convention (vorm-toeslag-regel.ts) altijd direct ná zijn
// maatwerk-parent gekoppeld. bouwOrderCommit mag die koppeling niet breken
// bij een gemengde split (filtert op is_maatwerk) of een IO-split (splitst
// regels op dekking — de companion heeft zelf nooit vrije_voorraad/tekort).
describe('VORMTOESLAG-companion volgt zijn maatwerk-parent (mig 465, array-positie-convention)', () => {
  const DEBITEUR_NR = 100001
  const HEADER = {
    klant_referentie: 'TEST-REF',
    afleverdatum: '2026-06-19',
    week: '25',
    fact_naam: 'Testklant BV',
    afl_naam: 'Testklant BV',
    afl_plaats: 'Utrecht',
    lever_type: 'week' as const,
  }

  const MAATWERK_MET_VORM: OrderRegelFormData = {
    artikelnr: 'MW-ROND', omschrijving: 'Maatwerk rond vloerkleed',
    orderaantal: 1, te_leveren: 1, prijs: 500, korting_pct: 0, bedrag: 500,
    is_maatwerk: true, maatwerk_kwaliteit_code: 'VERR', maatwerk_kleur_code: '130',
    maatwerk_lengte_cm: 240, maatwerk_breedte_cm: 240, maatwerk_vorm_toeslag: 75,
  }
  const VORMTOESLAG_COMPANION = maakVormToeslagRegel(MAATWERK_MET_VORM, 'Rond', 75)

  it('gemengde split: companion op de maatwerk-suborder, direct ná de parent', () => {
    const STANDAARD_REGEL: OrderRegelFormData = {
      artikelnr: '10001', omschrijving: 'Karpet 160x230',
      orderaantal: 2, te_leveren: 2, prijs: 150, korting_pct: 0, bedrag: 300,
      vrije_voorraad: 10,
    }
    const input: OrderCommitInput = {
      regels: [MAATWERK_MET_VORM, VORMTOESLAG_COMPANION, STANDAARD_REGEL],
      header: HEADER,
      debiteurNr: DEBITEUR_NR,
      afhalen: false,
      combiLeveringOverride: false,
      deelleveringen: true,
      afleverdatumInfo: {
        standaardDatum: '2026-06-12',
        maatwerkDatum: '2026-07-10',
        langsteDatum: '2026-07-10',
        heeftGemengd: true,
      },
      echteMaatwerkDatum: '2026-07-17',
    }

    const plan = bouwOrderCommit(input)

    expect(plan.gesplitst).toBe(true)
    const [standaardOrder, maatwerkOrder] = plan.orders

    // Standaard-suborder bevat geen vormtoeslag.
    expect(standaardOrder.regels.some(isVormToeslagRegel)).toBe(false)
    expect(standaardOrder.regels).toEqual([STANDAARD_REGEL])

    // Companion staat direct ná de maatwerk-parent op de maatwerk-suborder.
    expect(maatwerkOrder.regels).toEqual([MAATWERK_MET_VORM, VORMTOESLAG_COMPANION])
  })

  it('IO-split: companion blijft bij het deel waar zijn parent landt, en wordt nooit zelf op dekking gesplitst', () => {
    const TEKORT_VASTE_MAAT: OrderRegelFormData = {
      artikelnr: '20001', omschrijving: 'Karpet A',
      orderaantal: 10, te_leveren: 10, prijs: 100, korting_pct: 0, bedrag: 1000,
      vrije_voorraad: 4,
    }
    const input: OrderCommitInput = {
      regels: [MAATWERK_MET_VORM, VORMTOESLAG_COMPANION, TEKORT_VASTE_MAAT],
      header: HEADER,
      debiteurNr: DEBITEUR_NR,
      afhalen: false,
      combiLeveringOverride: false,
      deelleveringen: false,
      overrideLeverModus: 'deelleveringen',
      afleverdatumInfo: {
        standaardDatum: '2026-06-12',
        maatwerkDatum: null,
        langsteDatum: '2026-06-12',
        heeftGemengd: false,
      },
      echteMaatwerkDatum: null,
    }

    const plan = bouwOrderCommit(input)

    expect(plan.gesplitst).toBe(true)
    const alleRegels = plan.orders.flatMap(o => o.regels)

    // Companion exact 1× in het hele plan (nooit zelf gesplitst).
    expect(alleRegels.filter(isVormToeslagRegel)).toHaveLength(1)

    // De companion staat direct ná zijn maatwerk-parent, in dezelfde suborder.
    for (const order of plan.orders) {
      const idx = order.regels.findIndex(isVormToeslagRegel)
      if (idx === -1) continue
      expect(order.regels[idx - 1]?.artikelnr).toBe(MAATWERK_MET_VORM.artikelnr)
    }
  })
})
