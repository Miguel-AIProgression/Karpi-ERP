// frontend/src/modules/magazijn/__tests__/medewerker-rollen.contract.test.ts
//
// Contract-test voor de medewerkers-query-laag. Bewaakt dat de wrapper-
// functies in lib/supabase/queries/medewerkers.ts de juiste Supabase-calls
// construeren — geen echte DB-roundtrip. Pattern overgenomen van
// pickronde.contract.test.ts en magazijn-pickbaarheid.contract.test.ts.
//
// Bewijst:
//   - fetchPickers filtert op rollen-array bevat 'picker' en actief=true
//   - createPicker schrijft rollen={'picker'} en geen code
//   - addRolToMedewerker leest huidige rollen, dedupt, schrijft union
//   - removeRolVanMedewerker filtert de rol eruit
//   - fetchMedewerkers(rol) gebruikt .contains voor enum-array filter

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Recording fake Supabase-client
// ---------------------------------------------------------------------------

interface CallLog {
  table: string
  selects: string[]
  contains: Array<[string, unknown]>
  eqs: Array<[string, unknown]>
  orders: string[]
  inserted?: unknown
  updated?: unknown
  singleCalled: boolean
}

let calls: CallLog[] = []
let responseQueue: Array<{ data: unknown; error: unknown }> = []

function nextResponse() {
  return responseQueue.shift() ?? { data: null, error: null }
}

function buildChain(table: string) {
  const log: CallLog = {
    table,
    selects: [],
    contains: [],
    eqs: [],
    orders: [],
    singleCalled: false,
  }
  calls.push(log)

  const resolveNow = () => Promise.resolve(nextResponse())

  const chain = {
    select: (cols: string) => {
      log.selects.push(cols)
      return chain
    },
    contains: (col: string, val: unknown) => {
      log.contains.push([col, val])
      return chain
    },
    eq: (col: string, val: unknown) => {
      log.eqs.push([col, val])
      return chain
    },
    order: (col: string) => {
      log.orders.push(col)
      return chain
    },
    insert: (row: unknown) => {
      log.inserted = row
      return chain
    },
    update: (row: unknown) => {
      log.updated = row
      return chain
    },
    single: () => {
      log.singleCalled = true
      return resolveNow()
    },
    then: (
      resolve: (value: { data: unknown; error: unknown }) => void,
      reject: (reason: unknown) => void,
    ) => {
      resolveNow().then(resolve, reject)
    },
  }
  return chain
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => buildChain(table),
  },
}))

const {
  fetchMedewerkers,
  fetchPickers,
  createPicker,
  addRolToMedewerker,
  removeRolVanMedewerker,
} = await import('@/lib/supabase/queries/medewerkers')

beforeEach(() => {
  calls = []
  responseQueue = []
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchMedewerkers', () => {
  it('zonder rol-filter: select op medewerkers met order naam', async () => {
    responseQueue.push({ data: [], error: null })
    await fetchMedewerkers()
    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('medewerkers')
    expect(calls[0].selects[0]).toContain('rollen')
    expect(calls[0].orders).toEqual(['naam'])
    expect(calls[0].contains).toEqual([])
  })

  it('met rol="picker": filtert via contains rollen', async () => {
    responseQueue.push({ data: [], error: null })
    await fetchMedewerkers('picker')
    expect(calls[0].contains).toEqual([['rollen', ['picker']]])
  })

  it('gooit fout door als Supabase een error geeft', async () => {
    responseQueue.push({ data: null, error: { message: 'pg-fout' } })
    await expect(fetchMedewerkers()).rejects.toMatchObject({ message: 'pg-fout' })
  })
})

describe('fetchPickers', () => {
  it('filtert op rollen bevat picker EN actief=true, alleen id+naam', async () => {
    responseQueue.push({ data: [{ id: 1, naam: 'Jan' }], error: null })
    const result = await fetchPickers()
    expect(calls[0].table).toBe('medewerkers')
    expect(calls[0].selects[0]).toBe('id, naam')
    expect(calls[0].contains).toEqual([['rollen', ['picker']]])
    expect(calls[0].eqs).toEqual([['actief', true]])
    expect(calls[0].orders).toEqual(['naam'])
    expect(result).toEqual([{ id: 1, naam: 'Jan' }])
  })
})

describe('createPicker', () => {
  it('inserts met rollen=[picker], actief=true, geen code', async () => {
    responseQueue.push({
      data: { id: 5, naam: 'Test', code: null, email: null, telefoon: null, actief: true, rollen: ['picker'] },
      error: null,
    })
    const m = await createPicker('Test')
    expect(calls[0].inserted).toEqual({ naam: 'Test', rollen: ['picker'], actief: true })
    expect(calls[0].singleCalled).toBe(true)
    expect(m.id).toBe(5)
    expect(m.rollen).toEqual(['picker'])
  })
})

describe('addRolToMedewerker', () => {
  it('leest huidige rollen en schrijft union', async () => {
    responseQueue.push({ data: { rollen: ['vertegenwoordiger'] }, error: null })
    responseQueue.push({ data: null, error: null })

    await addRolToMedewerker(7, 'picker')

    expect(calls).toHaveLength(2)
    expect(calls[0].selects).toEqual(['rollen'])
    expect(calls[0].eqs).toEqual([['id', 7]])
    expect(calls[1].updated).toEqual({ rollen: ['vertegenwoordiger', 'picker'] })
    expect(calls[1].eqs).toEqual([['id', 7]])
  })

  it('skipt update als rol al aanwezig is', async () => {
    responseQueue.push({ data: { rollen: ['picker'] }, error: null })

    await addRolToMedewerker(7, 'picker')

    expect(calls).toHaveLength(1)
    expect(calls[0].updated).toBeUndefined()
  })
})

describe('removeRolVanMedewerker', () => {
  it('filtert de rol eruit en schrijft restant', async () => {
    responseQueue.push({ data: { rollen: ['vertegenwoordiger', 'picker'] }, error: null })
    responseQueue.push({ data: null, error: null })

    await removeRolVanMedewerker(7, 'picker')

    expect(calls[1].updated).toEqual({ rollen: ['vertegenwoordiger'] })
  })

  it('lege resulterende array is toegestaan (geen guard)', async () => {
    responseQueue.push({ data: { rollen: ['picker'] }, error: null })
    responseQueue.push({ data: null, error: null })

    await removeRolVanMedewerker(7, 'picker')

    expect(calls[1].updated).toEqual({ rollen: [] })
  })
})
