// Deno test: `deno test supabase/functions/_shared/externe-payload-audit.test.ts`
//
// Pint het best-effort-contract van de payload-audit vast: de juiste RPC's met
// de juiste parameters (incl. richting/status defaults), én — kritiek — dat een
// falende/throwende RPC de caller NOOIT laat crashen (loggen mag verwerking
// niet blokkeren).

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { logExternePayload, markeerExternePayload } from './externe-payload-audit.ts'

interface RpcCall {
  fn: string
  args: Record<string, unknown>
}

function fakeSupabase(behavior: {
  data?: unknown
  error?: { message: string } | null
  throwMsg?: string
}) {
  const calls: RpcCall[] = []
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args })
      if (behavior.throwMsg) throw new Error(behavior.throwMsg)
      return Promise.resolve({ data: behavior.data ?? null, error: behavior.error ?? null })
    },
    // deno-lint-ignore no-explicit-any
  } as any
  return { client, calls }
}

Deno.test('logExternePayload — inbound default: status ontvangen, richting in', async () => {
  const { client, calls } = fakeSupabase({ data: 42 })
  const id = await logExternePayload(client, {
    kanaal: 'shopify',
    raw: '{"id":123}',
    bron: 'karpi.myshopify.com',
    externeId: '123',
    json: { id: 123 },
  })
  assertEquals(id, 42)
  assertEquals(calls[0].fn, 'log_externe_payload')
  assertEquals(calls[0].args.p_kanaal, 'shopify')
  assertEquals(calls[0].args.p_richting, 'in')
  assertEquals(calls[0].args.p_status, 'ontvangen')
  assertEquals(calls[0].args.p_payload_raw, '{"id":123}')
  assertEquals(calls[0].args.p_payload_json, { id: 123 })
  assertEquals(calls[0].args.p_order_id, null)
  assertEquals(calls[0].args.p_fout, null)
})

Deno.test('logExternePayload — outbound one-step: richting out + eindstatus + order_id', async () => {
  const { client, calls } = fakeSupabase({ data: 7 })
  await logExternePayload(client, {
    kanaal: 'orderbevestiging',
    raw: '<html>...</html>',
    bron: 'resend',
    externeId: 'msg-1',
    richting: 'out',
    status: 'verwerkt',
    orderId: 2575,
  })
  assertEquals(calls[0].args.p_richting, 'out')
  assertEquals(calls[0].args.p_status, 'verwerkt')
  assertEquals(calls[0].args.p_order_id, 2575)
})

Deno.test('logExternePayload — RPC-error geeft null, gooit niet', async () => {
  const { client } = fakeSupabase({ error: { message: 'boom' } })
  assertEquals(await logExternePayload(client, { kanaal: 'x', raw: '{}', bron: 'x', externeId: null }), null)
})

Deno.test('logExternePayload — exception geeft null, gooit niet', async () => {
  const { client } = fakeSupabase({ throwMsg: 'network down' })
  assertEquals(await logExternePayload(client, { kanaal: 'x', raw: '{}', bron: 'x', externeId: null }), null)
})

Deno.test('markeerExternePayload — verwerkt mapt order_id', async () => {
  const { client, calls } = fakeSupabase({})
  await markeerExternePayload(client, 7, 'verwerkt', { orderId: 2575 })
  assertEquals(calls[0].fn, 'markeer_externe_payload_verwerkt')
  assertEquals(calls[0].args.p_id, 7)
  assertEquals(calls[0].args.p_status, 'verwerkt')
  assertEquals(calls[0].args.p_order_id, 2575)
})

Deno.test('markeerExternePayload — fout mapt reden', async () => {
  const { client, calls } = fakeSupabase({})
  await markeerExternePayload(client, 7, 'fout', { fout: 'Geen debiteur gevonden' })
  assertEquals(calls[0].args.p_status, 'fout')
  assertEquals(calls[0].args.p_fout, 'Geen debiteur gevonden')
})

Deno.test('markeerExternePayload — null id is no-op (geen RPC)', async () => {
  const { client, calls } = fakeSupabase({})
  await markeerExternePayload(client, null, 'verwerkt', { orderId: 1 })
  assertEquals(calls.length, 0)
})

Deno.test('markeerExternePayload — exception wordt geslikt', async () => {
  const { client } = fakeSupabase({ throwMsg: 'db gone' })
  await markeerExternePayload(client, 7, 'verwerkt', { orderId: 1 })
})
