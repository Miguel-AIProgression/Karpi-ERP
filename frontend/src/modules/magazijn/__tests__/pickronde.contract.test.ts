// frontend/src/modules/magazijn/__tests__/pickronde.contract.test.ts
//
// Contract tests voor de drie Pickronde-RPC-wrappers. Documenteert RPC-naam,
// argument-shape en response-parsing — geen integratie met echte Supabase.
// Pattern overgenomen van magazijn-pickbaarheid.contract.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const rpcCalls: Array<{ fn: string; args: unknown }> = []
let nextRpcResponse: { data: unknown; error: unknown } = { data: null, error: null }

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve(nextRpcResponse)
    },
  },
}))

import {
  startPickronde,
  markeerColliNietGevonden,
  voltooiPickronde,
} from '../queries/pickronde'

beforeEach(() => {
  rpcCalls.length = 0
  nextRpcResponse = { data: null, error: null }
})

describe('startPickronde', () => {
  it('roept RPC start_pickronde aan met p_order_id en returnt het zending-id', async () => {
    nextRpcResponse = { data: 42, error: null }
    const id = await startPickronde(123)
    expect(rpcCalls).toEqual([{ fn: 'start_pickronde', args: { p_order_id: 123 } }])
    expect(id).toBe(42)
  })

  it('gooit fout met message van Supabase als RPC faalt', async () => {
    nextRpcResponse = { data: null, error: { message: 'Order bestaat niet' } }
    await expect(startPickronde(999)).rejects.toThrow('Order bestaat niet')
  })
})

describe('markeerColliNietGevonden', () => {
  it('blokkeer-modus zonder opmerking', async () => {
    await markeerColliNietGevonden({ colliId: 7, modus: 'blokkeer' })
    expect(rpcCalls).toEqual([{
      fn: 'markeer_colli_niet_gevonden',
      args: { p_zending_colli_id: 7, p_modus: 'blokkeer', p_opmerking: null },
    }])
  })

  it('splits-modus met opmerking', async () => {
    await markeerColliNietGevonden({ colliId: 8, modus: 'splits', opmerking: 'rol kwijt' })
    expect(rpcCalls).toEqual([{
      fn: 'markeer_colli_niet_gevonden',
      args: { p_zending_colli_id: 8, p_modus: 'splits', p_opmerking: 'rol kwijt' },
    }])
  })

  it('gooit fout met details bij splits-zonder-deelleveringen', async () => {
    nextRpcResponse = {
      data: null,
      error: { message: "Splitsen vereist order.lever_modus='deelleveringen'" },
    }
    await expect(
      markeerColliNietGevonden({ colliId: 9, modus: 'splits' })
    ).rejects.toThrow(/deelleveringen/)
  })
})

describe('voltooiPickronde', () => {
  it('roept RPC voltooi_pickronde aan met p_zending_id', async () => {
    nextRpcResponse = { data: 42, error: null }
    const id = await voltooiPickronde(42)
    expect(rpcCalls).toEqual([{ fn: 'voltooi_pickronde', args: { p_zending_id: 42 } }])
    expect(id).toBe(42)
  })

  it('gooit fout met restrict_violation-context bij openstaande problemen', async () => {
    nextRpcResponse = {
      data: null,
      error: { message: 'Pickronde heeft 2 openstaand(e) pick-probleem(en)', code: '23001' },
    }
    await expect(voltooiPickronde(42)).rejects.toThrow(/openstaand/)
  })
})
