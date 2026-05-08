import { beforeEach, describe, expect, it, vi } from 'vitest'

type SupabaseResponse = { data: unknown; error: { code?: string; message?: string } | null }

const responses: Record<string, SupabaseResponse[]> = {}
const selects: string[] = []

function queueResponse(table: string, response: SupabaseResponse) {
  responses[table] ??= []
  responses[table].push(response)
}

function nextResponse(table: string): SupabaseResponse {
  const next = responses[table]?.shift()
  if (!next) throw new Error(`Geen response voor tabel "${table}" in test-queue`)
  return next
}

function buildChain(table: string) {
  const chain = {
    select: (query: string) => {
      selects.push(query)
      return chain
    },
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => Promise.resolve(nextResponse(table)),
    then: (
      resolve: (value: SupabaseResponse) => void,
      reject: (reason: unknown) => void,
    ) => {
      try {
        resolve(nextResponse(table))
      } catch (err) {
        reject(err)
      }
    },
  }
  return chain
}

const fakeSupabase = {
  from: (table: string) => buildChain(table),
}

vi.mock('@/lib/supabase/client', () => ({ supabase: fakeSupabase }))

const { fetchZendingen, fetchZendingMetTransportorders, fetchZendingPrintSet } = await import(
  '../queries/zendingen'
)

beforeEach(() => {
  for (const k of Object.keys(responses)) delete responses[k]
  selects.length = 0
})

describe('logistiek zendingen queries', () => {
  it('disambigueert orders naar de bestellende debiteur, niet de betaler', async () => {
    queueResponse('zendingen', { data: [], error: null })
    queueResponse('zendingen', { data: {}, error: null })
    queueResponse('zendingen', { data: {}, error: null })

    await fetchZendingen()
    await fetchZendingMetTransportorders('ZEN-2026-0001')
    await fetchZendingPrintSet('ZEN-2026-0001')

    expect(selects).toHaveLength(3)
    for (const select of selects) {
      expect(select).toContain('debiteuren:debiteuren!orders_debiteur_nr_fkey')
      expect(select).not.toContain('\n        debiteuren (')
    }
  })
})
