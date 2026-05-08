import { describe, it, expect, beforeEach, vi } from 'vitest'

const supabaseCalls: any[] = []
let nextResponse: any = { data: null, error: null }

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: (col: string, val: any) => ({
          single: () => {
            supabaseCalls.push({ op: 'select', table, cols, col, val })
            return Promise.resolve(nextResponse)
          },
        }),
      }),
      update: (patch: any) => ({
        eq: (col: string, val: any) => {
          supabaseCalls.push({ op: 'update', table, patch, col, val })
          return Promise.resolve(nextResponse)
        },
      }),
    }),
  },
}))

import {
  fetchKlantFactuurInstellingen,
  updateKlantFactuurInstellingen,
} from '../queries/klant-factuur-instellingen'

beforeEach(() => {
  supabaseCalls.length = 0
  nextResponse = { data: null, error: null }
})

describe('fetchKlantFactuurInstellingen', () => {
  it('selecteert facturatie-velden uit debiteuren op debiteur_nr', async () => {
    nextResponse = {
      data: { factuurvoorkeur: 'wekelijks', btw_percentage: 21, email_factuur: 'a@b.nl' },
      error: null,
    }
    const r = await fetchKlantFactuurInstellingen(123)
    expect(supabaseCalls[0]).toMatchObject({
      op: 'select',
      table: 'debiteuren',
      col: 'debiteur_nr',
      val: 123,
    })
    expect(r).toEqual({ factuurvoorkeur: 'wekelijks', btw_percentage: 21, email_factuur: 'a@b.nl' })
  })
})

describe('updateKlantFactuurInstellingen', () => {
  it('update alleen de drie facturatie-velden', async () => {
    await updateKlantFactuurInstellingen(123, { factuurvoorkeur: 'per_zending' })
    expect(supabaseCalls[0]).toMatchObject({
      op: 'update',
      table: 'debiteuren',
      patch: { factuurvoorkeur: 'per_zending' },
      col: 'debiteur_nr',
      val: 123,
    })
  })
})
