// Contract tests voor Order-lifecycle Module RPC-wrappers.
// Pattern overgenomen van magazijn/__tests__/pickronde.contract.test.ts.

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
  markeerVerzonden,
  markeerGeannuleerd,
  herberekenWachtStatus,
} from '../queries/transities'

beforeEach(() => {
  rpcCalls.length = 0
  nextRpcResponse = { data: null, error: null }
})

describe('markeerVerzonden', () => {
  it('roept RPC markeer_verzonden aan met p_order_id en optionele actor', async () => {
    await markeerVerzonden({ orderId: 123, actorMedewerkerId: 7 })
    expect(rpcCalls).toEqual([{
      fn: 'markeer_verzonden',
      args: { p_order_id: 123, p_actor_medewerker_id: 7, p_actor_auth_user_id: null }
    }])
  })

  it('zonder actor stuurt beide null', async () => {
    await markeerVerzonden({ orderId: 5 })
    expect(rpcCalls[0].args).toMatchObject({
      p_order_id: 5,
      p_actor_medewerker_id: null,
      p_actor_auth_user_id: null,
    })
  })

  it('propageert RPC-fout als Error', async () => {
    nextRpcResponse = { data: null, error: { message: 'Order bestaat niet' } }
    await expect(markeerVerzonden({ orderId: 999 })).rejects.toThrow('Order bestaat niet')
  })
})
