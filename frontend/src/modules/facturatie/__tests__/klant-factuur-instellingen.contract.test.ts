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
  it('selecteert alle facturatie-velden inclusief factuurvoorkeur uit debiteuren', async () => {
    nextResponse = {
      data: {
        btw_percentage: 21,
        btw_verlegd_intracom: true,
        email_factuur: 'a@b.nl',
        factuurvoorkeur: 'per_zending',
        toeslag_actief: false,
        toeslag_procent: null,
        toeslag_omschrijving: null,
        toeslag_begindatum: null,
        toeslag_einddatum: null,
      },
      error: null,
    }
    const r = await fetchKlantFactuurInstellingen(123)
    expect(supabaseCalls[0]).toMatchObject({
      op: 'select',
      table: 'debiteuren',
      col: 'debiteur_nr',
      val: 123,
    })
    // Verifieer dat factuurvoorkeur in de select-string staat
    expect(supabaseCalls[0].cols).toContain('factuurvoorkeur')
    // Verifieer dat de kerntriplet nog steeds aanwezig is
    expect(supabaseCalls[0].cols).toContain('btw_percentage')
    expect(supabaseCalls[0].cols).toContain('btw_verlegd_intracom')
    expect(supabaseCalls[0].cols).toContain('email_factuur')
    expect(r?.factuurvoorkeur).toBe('per_zending')
  })

  it('geeft wekelijks terug als dat ingesteld is', async () => {
    nextResponse = {
      data: {
        btw_percentage: 21,
        btw_verlegd_intracom: false,
        email_factuur: 'factuur@klant.nl',
        factuurvoorkeur: 'wekelijks',
        toeslag_actief: false,
        toeslag_procent: null,
        toeslag_omschrijving: null,
        toeslag_begindatum: null,
        toeslag_einddatum: null,
      },
      error: null,
    }
    const r = await fetchKlantFactuurInstellingen(260000)
    expect(r?.factuurvoorkeur).toBe('wekelijks')
  })
})

describe('updateKlantFactuurInstellingen', () => {
  it('kan btw_percentage patchen', async () => {
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

  it('kan factuurvoorkeur omzetten naar wekelijks', async () => {
    await updateKlantFactuurInstellingen(260000, { factuurvoorkeur: 'wekelijks' })
    expect(supabaseCalls[0]).toMatchObject({
      op: 'update',
      table: 'debiteuren',
      patch: { factuurvoorkeur: 'wekelijks' },
      col: 'debiteur_nr',
      val: 260000,
    })
  })

  it('kan factuurvoorkeur terugzetten naar per_zending', async () => {
    await updateKlantFactuurInstellingen(260000, { factuurvoorkeur: 'per_zending' })
    expect(supabaseCalls[0]).toMatchObject({
      op: 'update',
      table: 'debiteuren',
      patch: { factuurvoorkeur: 'per_zending' },
      col: 'debiteur_nr',
      val: 260000,
    })
  })
})
