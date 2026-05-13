// Contract tests voor Levertijd-Module query-wrappers (mig 277).
// Pattern overgenomen van orders-lifecycle/__tests__/transities.contract.test.ts.
//
// Smoke-test scope: RPC-naam, parameter-shape, empty-input short-circuit, en
// error-propagatie. Geen end-to-end-test — die hoort bij stap 7 (capaciteit-
// match) en stap 6 (order-form integratie).

import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchFitCheck,
  fetchSnelsteHaalbaar,
  fetchLevertijdStatus,
} from '../queries/levertijd'

interface RpcCall {
  fn: string
  args: unknown
}

interface FromCall {
  table: string
  select: string | null
  eqColumn: string | null
  eqValue: unknown
}

let rpcCalls: RpcCall[] = []
let fromCalls: FromCall[] = []
let nextRpcResponse: { data: unknown; error: unknown } = { data: null, error: null }
let nextFromResponse: { data: unknown; error: unknown } = { data: null, error: null }

function makeFakeClient(): SupabaseClient {
  return {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve(nextRpcResponse)
    },
    from: (table: string) => {
      const call: FromCall = { table, select: null, eqColumn: null, eqValue: null }
      fromCalls.push(call)
      const chain = {
        select: (sel: string) => {
          call.select = sel
          return chain
        },
        eq: (col: string, val: unknown) => {
          call.eqColumn = col
          call.eqValue = val
          return chain
        },
        single: () => Promise.resolve(nextFromResponse),
      }
      return chain
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

beforeEach(() => {
  rpcCalls = []
  fromCalls = []
  nextRpcResponse = { data: null, error: null }
  nextFromResponse = { data: null, error: null }
})

describe('fetchFitCheck', () => {
  it('lege regel-array → returnt [] zonder RPC-call', async () => {
    const client = makeFakeClient()
    const result = await fetchFitCheck(client, [], '2026-W25')
    expect(result).toEqual([])
    expect(rpcCalls).toEqual([])
  })

  it('roept levertijd_fit_check aan met p_regel_ids + p_gewenste_week', async () => {
    nextRpcResponse = { data: [], error: null }
    const client = makeFakeClient()
    await fetchFitCheck(client, [1, 2, 3], '2026-W25')
    expect(rpcCalls).toEqual([{
      fn: 'levertijd_fit_check',
      args: { p_regel_ids: [1, 2, 3], p_gewenste_week: '2026-W25' },
    }])
  })

  it('mapt RPC-result door als FitCheckResultaat[]', async () => {
    nextRpcResponse = {
      data: [{ regel_id: 1, haalbaar: true, reden: null, eerstvolgend_haalbaar: '2026-W25' }],
      error: null,
    }
    const client = makeFakeClient()
    const result = await fetchFitCheck(client, [1], '2026-W25')
    expect(result).toEqual([
      { regel_id: 1, haalbaar: true, reden: null, eerstvolgend_haalbaar: '2026-W25' },
    ])
  })

  it('propageert RPC-fout als throw', async () => {
    nextRpcResponse = { data: null, error: { message: 'boom' } }
    const client = makeFakeClient()
    await expect(fetchFitCheck(client, [1], '2026-W25')).rejects.toMatchObject({ message: 'boom' })
  })
})

describe('fetchSnelsteHaalbaar', () => {
  it('lege regel-array → returnt [] zonder RPC-call', async () => {
    const client = makeFakeClient()
    const result = await fetchSnelsteHaalbaar(client, [])
    expect(result).toEqual([])
    expect(rpcCalls).toEqual([])
  })

  it('roept levertijd_snelste_haalbaar aan met p_regel_ids', async () => {
    nextRpcResponse = { data: [], error: null }
    const client = makeFakeClient()
    await fetchSnelsteHaalbaar(client, [5, 6])
    expect(rpcCalls).toEqual([{
      fn: 'levertijd_snelste_haalbaar',
      args: { p_regel_ids: [5, 6] },
    }])
  })

  it('propageert RPC-fout als throw', async () => {
    nextRpcResponse = { data: null, error: { message: 'rpc-fail' } }
    const client = makeFakeClient()
    await expect(fetchSnelsteHaalbaar(client, [1])).rejects.toMatchObject({ message: 'rpc-fail' })
  })
})

describe('fetchLevertijdStatus', () => {
  it('leest 3 kolommen uit orders en mapt naar { levertijd_status, snapshot, afleverdatum }', async () => {
    nextFromResponse = {
      data: {
        levertijd_status: 'standaard',
        standaard_afleverdatum_berekend: '2026-06-12',
        afleverdatum: '2026-06-12',
      },
      error: null,
    }
    const client = makeFakeClient()
    const result = await fetchLevertijdStatus(client, 42)
    expect(fromCalls).toHaveLength(1)
    expect(fromCalls[0]).toMatchObject({
      table: 'orders',
      select: 'levertijd_status, standaard_afleverdatum_berekend, afleverdatum',
      eqColumn: 'id',
      eqValue: 42,
    })
    expect(result).toEqual({
      levertijd_status: 'standaard',
      standaard_afleverdatum_berekend: '2026-06-12',
      afleverdatum: '2026-06-12',
    })
  })

  it('coerceert ontbrekende velden naar null', async () => {
    nextFromResponse = {
      data: { levertijd_status: null, standaard_afleverdatum_berekend: null, afleverdatum: null },
      error: null,
    }
    const client = makeFakeClient()
    const result = await fetchLevertijdStatus(client, 7)
    expect(result).toEqual({
      levertijd_status: null,
      standaard_afleverdatum_berekend: null,
      afleverdatum: null,
    })
  })

  it('propageert select-fout als throw', async () => {
    nextFromResponse = { data: null, error: { message: 'not found' } }
    const client = makeFakeClient()
    await expect(fetchLevertijdStatus(client, 999)).rejects.toMatchObject({ message: 'not found' })
  })
})
