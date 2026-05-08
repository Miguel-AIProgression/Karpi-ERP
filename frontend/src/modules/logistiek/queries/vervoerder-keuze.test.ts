// frontend/src/modules/logistiek/queries/vervoerder-keuze.test.ts
import { describe, expect, it } from 'vitest'
import { aggregeerVervoerderKeuzeVoorOrder } from './vervoerder-keuze'
import type { OrderregelVervoerder } from './orderregel-vervoerder'

function maakRegel(over: Partial<OrderregelVervoerder> = {}): OrderregelVervoerder {
  return {
    orderregel_id: 1,
    override_code: null,
    evaluator_code: null,
    evaluator_service: null,
    effectief_code: null,
    effectief_service: null,
    bron: 'geen',
    is_locked: false,
    uitleg: null,
    ...over,
  }
}

describe('aggregeerVervoerderKeuzeVoorOrder', () => {
  it('returnt soort=leeg voor 0 regels', () => {
    expect(aggregeerVervoerderKeuzeVoorOrder([])).toEqual({ soort: 'leeg' })
  })

  it('returnt soort=uniform als alle regels dezelfde code hebben', () => {
    const regels = [
      maakRegel({ orderregel_id: 1, effectief_code: 'DPD', bron: 'regel' }),
      maakRegel({ orderregel_id: 2, effectief_code: 'DPD', bron: 'regel' }),
    ]
    expect(aggregeerVervoerderKeuzeVoorOrder(regels)).toEqual({
      soort: 'uniform',
      code: 'DPD',
      bron: 'regel',
    })
  })

  it('returnt soort=uniform met code=null als alle regels NULL effectief hebben', () => {
    const regels = [
      maakRegel({ orderregel_id: 1, effectief_code: null, bron: 'geen' }),
      maakRegel({ orderregel_id: 2, effectief_code: null, bron: 'geen' }),
    ]
    expect(aggregeerVervoerderKeuzeVoorOrder(regels)).toEqual({
      soort: 'uniform',
      code: null,
      bron: 'geen',
    })
  })

  it('returnt soort=mix met unieke codes als regels verschillen', () => {
    const regels = [
      maakRegel({ orderregel_id: 1, effectief_code: 'DPD', bron: 'regel' }),
      maakRegel({ orderregel_id: 2, effectief_code: 'UPS', bron: 'regel' }),
      maakRegel({ orderregel_id: 3, effectief_code: 'DPD', bron: 'regel' }),
    ]
    const result = aggregeerVervoerderKeuzeVoorOrder(regels)
    expect(result.soort).toBe('mix')
    if (result.soort === 'mix') {
      expect(result.codes.sort()).toEqual(['DPD', 'UPS'])
    }
  })

  it('returnt soort=mix als deel NULL en deel een code heeft', () => {
    const regels = [
      maakRegel({ orderregel_id: 1, effectief_code: 'DPD', bron: 'regel' }),
      maakRegel({ orderregel_id: 2, effectief_code: null, bron: 'geen' }),
    ]
    const result = aggregeerVervoerderKeuzeVoorOrder(regels)
    expect(result.soort).toBe('mix')
  })
})
