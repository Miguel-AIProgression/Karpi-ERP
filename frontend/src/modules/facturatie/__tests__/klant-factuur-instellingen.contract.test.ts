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
  it('selecteert btw_percentage + btw_verlegd_intracom + email_factuur uit debiteuren op debiteur_nr', async () => {
    nextResponse = {
      data: { btw_percentage: 21, btw_verlegd_intracom: true, email_factuur: 'a@b.nl' },
      error: null,
    }
    const r = await fetchKlantFactuurInstellingen(123)
    expect(supabaseCalls[0]).toMatchObject({
      op: 'select',
      table: 'debiteuren',
      cols: 'btw_percentage, btw_verlegd_intracom, email_factuur',
      col: 'debiteur_nr',
      val: 123,
    })
    expect(r).toEqual({ btw_percentage: 21, btw_verlegd_intracom: true, email_factuur: 'a@b.nl' })
  })
})

describe('updateKlantFactuurInstellingen', () => {
  it('update alleen de twee facturatie-velden', async () => {
    await updateKlantFactuurInstellingen(123, { btw_percentage: 0 })
    expect(supabaseCalls[0]).toMatchObject({
      op: 'update',
      table: 'debiteuren',
      patch: { btw_percentage: 0 },
      col: 'debiteur_nr',
      val: 123,
    })
  })

  it('kan btw_verlegd_intracom patchen', async () => {
    await updateKlantFactuurInstellingen(123, { btw_verlegd_intracom: false })
    expect(supabaseCalls[0]).toMatchObject({
      op: 'update',
      table: 'debiteuren',
      patch: { btw_verlegd_intracom: false },
      col: 'debiteur_nr',
      val: 123,
    })
  })
})
