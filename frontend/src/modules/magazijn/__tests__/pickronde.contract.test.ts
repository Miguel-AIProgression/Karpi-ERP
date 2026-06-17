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
  voltooiPickrondes,
} from '../queries/pickronde'

beforeEach(() => {
  rpcCalls.length = 0
  nextRpcResponse = { data: null, error: null }
})

describe('startPickronde', () => {
  it('roept RPC start_pickronde aan met p_order_id + p_picker_id en returnt zending-id', async () => {
    nextRpcResponse = { data: 42, error: null }
    const id = await startPickronde(123, 7)
    expect(rpcCalls).toEqual([
      { fn: 'start_pickronde', args: { p_order_id: 123, p_picker_id: 7 } },
    ])
    expect(id).toBe(42)
  })

  it('gooit fout met message van Supabase als RPC faalt', async () => {
    nextRpcResponse = { data: null, error: { message: 'Order bestaat niet' } }
    await expect(startPickronde(999, 7)).rejects.toThrow('Order bestaat niet')
  })

  it('mig 217: propageert picker-validatie-fout uit DB (geen actieve picker)', async () => {
    nextRpcResponse = {
      data: null,
      error: { message: 'Medewerker 99 is geen actieve picker', code: '22023' },
    }
    await expect(startPickronde(1, 99)).rejects.toThrow(/geen actieve picker/)
  })
})

describe('markeerColliNietGevonden', () => {
  it('blokkeer-modus zonder opmerking, met pickerId', async () => {
    await markeerColliNietGevonden({ colliId: 7, modus: 'blokkeer', pickerId: 3 })
    expect(rpcCalls).toEqual([{
      fn: 'markeer_colli_niet_gevonden',
      args: { p_zending_colli_id: 7, p_modus: 'blokkeer', p_opmerking: null, p_picker_id: 3 },
    }])
  })

  it('splits-modus met opmerking en pickerId', async () => {
    await markeerColliNietGevonden({
      colliId: 8,
      modus: 'splits',
      opmerking: 'rol kwijt',
      pickerId: 5,
    })
    expect(rpcCalls).toEqual([{
      fn: 'markeer_colli_niet_gevonden',
      args: { p_zending_colli_id: 8, p_modus: 'splits', p_opmerking: 'rol kwijt', p_picker_id: 5 },
    }])
  })

  it('gooit fout met details bij splits-zonder-deelleveringen', async () => {
    nextRpcResponse = {
      data: null,
      error: { message: "Splitsen vereist order.lever_modus='deelleveringen'" },
    }
    await expect(
      markeerColliNietGevonden({ colliId: 9, modus: 'splits', pickerId: 1 })
    ).rejects.toThrow(/deelleveringen/)
  })
})

describe('voltooiPickronde', () => {
  it('roept RPC voltooi_pickronde aan met p_zending_id + p_picker_id', async () => {
    nextRpcResponse = { data: 42, error: null }
    const id = await voltooiPickronde(42, 3)
    expect(rpcCalls).toEqual([
      { fn: 'voltooi_pickronde', args: { p_zending_id: 42, p_picker_id: 3 } },
    ])
    expect(id).toBe(42)
  })

  it('gooit fout met restrict_violation-context bij openstaande problemen', async () => {
    nextRpcResponse = {
      data: null,
      error: { message: 'Pickronde heeft 2 openstaand(e) pick-probleem(en)', code: '23001' },
    }
    await expect(voltooiPickronde(42, 3)).rejects.toThrow(/openstaand/)
  })
})

describe('voltooiPickrondes (bulk, mig 412)', () => {
  it('roept RPC voltooi_pickronden aan met p_zending_ids + p_picker_id en parset per-zending-uitkomsten', async () => {
    nextRpcResponse = {
      data: [
        { zending_id: 10, zending_nr: 'ZEND-0010', ok: true, reden: null },
        { zending_id: 11, zending_nr: 'ZEND-0011', ok: false, reden: 'Pickronde heeft 1 openstaand(e) pick-probleem(en)' },
      ],
      error: null,
    }
    const result = await voltooiPickrondes([10, 11], 3)
    expect(rpcCalls).toEqual([
      { fn: 'voltooi_pickronden', args: { p_zending_ids: [10, 11], p_picker_id: 3 } },
    ])
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ zending_id: 10, zending_nr: 'ZEND-0010', ok: true, reden: null })
    expect(result[1].ok).toBe(false)
    expect(result[1].reden).toMatch(/openstaand/)
  })

  it('picker is optioneel (mig 394): mag NULL meesturen', async () => {
    nextRpcResponse = { data: [], error: null }
    await voltooiPickrondes([10], null)
    expect(rpcCalls).toEqual([
      { fn: 'voltooi_pickronden', args: { p_zending_ids: [10], p_picker_id: null } },
    ])
  })

  it('gooit fout bij harde RPC-fout', async () => {
    nextRpcResponse = { data: null, error: { message: 'Medewerker 99 is geen actieve picker' } }
    await expect(voltooiPickrondes([10], 99)).rejects.toThrow(/geen actieve picker/)
  })
})
