// Tests voor `fetchMaatwerkLevertijdHint` na T002-refactor (#27).
//
// De functie leest sinds T002 uit de Voorraadpositie-Module
// (`fetchVoorraadpositie`) i.p.v. direct uit RPC `besteld_per_kwaliteit_kleur`.
// Deze tests borgen drie invarianten:
//   1. Ghost-paar (geen eigen voorraad, wél besteld) → `inkoop_bekend`-hint.
//   2. Geen besteld én geen voorraad → `geen_inkoop`.
//   3. Eigen voorraad blokkeert de hint, ook als er besteld is.
//
// Mock-strategie: zowel `@/modules/voorraadpositie` als `@/lib/supabase/client`
// gemockt. De Voorraadpositie-mock retourneert een gestubde positie; supabase
// stubs dekken de `app_config`-fetch en de `iso_week_plus`-RPC.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Voorraadpositie } from '@/modules/voorraadpositie'

// === Module-mocks ===

const fetchVoorraadpositieMock = vi.fn()
vi.mock('@/modules/voorraadpositie', () => ({
  fetchVoorraadpositie: fetchVoorraadpositieMock,
}))

// Supabase-client mock: from() chaint .select().eq().maybeSingle() voor app_config;
// rpc() voor iso_week_plus.
const maybeSingleMock = vi.fn()
const rpcMock = vi.fn()
const fromMock = vi.fn(() => ({
  select: vi.fn(() => ({
    eq: vi.fn(() => ({
      maybeSingle: maybeSingleMock,
    })),
  })),
}))

vi.mock('../../client', () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
  },
}))

const { fetchMaatwerkLevertijdHint } = await import('../op-maat')

// === Helpers ===

function makePositie(overrides: {
  totaal_m2?: number
  eerstvolgende_verwacht_datum?: string | null
  beste_partner?: Voorraadpositie['beste_partner']
}): Voorraadpositie {
  return {
    kwaliteit_code: 'TAP',
    kleur_code: '15',
    product_naam: 'TAP 15',
    voorraad: {
      volle_rollen: 0,
      aangebroken_rollen: 0,
      reststuk_rollen: 0,
      totaal_m2: overrides.totaal_m2 ?? 0,
    },
    rollen: [],
    partners: overrides.beste_partner ? [overrides.beste_partner] : [],
    beste_partner: overrides.beste_partner ?? null,
    besteld: {
      besteld_m: 0,
      besteld_m2: 0,
      orders_count: 0,
      eerstvolgende_leverweek: null,
      eerstvolgende_verwacht_datum: overrides.eerstvolgende_verwacht_datum ?? null,
      eerstvolgende_m: 0,
      eerstvolgende_m2: 0,
    },
  }
}

beforeEach(() => {
  fetchVoorraadpositieMock.mockReset()
  maybeSingleMock.mockReset()
  rpcMock.mockReset()
  fromMock.mockClear()
})

describe('fetchMaatwerkLevertijdHint — Voorraadpositie-Module seam (T002)', () => {
  it('ghost-paar: geen voorraad, wel besteld → inkoop_bekend met leverweek', async () => {
    fetchVoorraadpositieMock.mockResolvedValueOnce(
      makePositie({
        totaal_m2: 0,
        eerstvolgende_verwacht_datum: '2026-06-15',
      }),
    )
    maybeSingleMock.mockResolvedValueOnce({
      data: { waarde: { inkoop_buffer_weken_maatwerk: 2 } },
      error: null,
    })
    rpcMock.mockResolvedValueOnce({ data: '2026-W26', error: null })

    const result = await fetchMaatwerkLevertijdHint('TAP', '15')

    expect(result).toEqual({
      status: 'inkoop_bekend',
      verwacht_datum: '2026-06-15',
      verwachte_leverweek: '2026-W26',
    })
    // Verifieer dat de Module-seam wordt gebruikt (geen directe besteld-RPC).
    expect(fetchVoorraadpositieMock).toHaveBeenCalledWith('TAP', '15')
    expect(rpcMock).toHaveBeenCalledWith('iso_week_plus', {
      p_datum: '2026-06-15',
      p_weken: 2,
    })
    // Geen call naar besteld_per_kwaliteit_kleur.
    const rpcCalls = rpcMock.mock.calls.map((c) => c[0])
    expect(rpcCalls).not.toContain('besteld_per_kwaliteit_kleur')
  })

  it('default buffer 2 weken als app_config geen waarde heeft', async () => {
    fetchVoorraadpositieMock.mockResolvedValueOnce(
      makePositie({
        totaal_m2: 0,
        eerstvolgende_verwacht_datum: '2026-07-01',
      }),
    )
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null })
    rpcMock.mockResolvedValueOnce({ data: '2026-W29', error: null })

    const result = await fetchMaatwerkLevertijdHint('TAP', '15')

    expect(result.status).toBe('inkoop_bekend')
    expect(rpcMock).toHaveBeenCalledWith('iso_week_plus', {
      p_datum: '2026-07-01',
      p_weken: 2,
    })
  })

  it('geen besteld én geen voorraad → geen_inkoop', async () => {
    fetchVoorraadpositieMock.mockResolvedValueOnce(
      makePositie({
        totaal_m2: 0,
        eerstvolgende_verwacht_datum: null,
      }),
    )

    const result = await fetchMaatwerkLevertijdHint('TAP', '15')

    expect(result).toEqual({ status: 'geen_inkoop' })
    // Geen onnodige config / week-RPC-calls.
    expect(maybeSingleMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('eigen voorraad blokkeert hint — ook als er besteld is', async () => {
    fetchVoorraadpositieMock.mockResolvedValueOnce(
      makePositie({
        totaal_m2: 80, // voorraad aanwezig
        eerstvolgende_verwacht_datum: '2026-06-15', // én besteld
      }),
    )

    const result = await fetchMaatwerkLevertijdHint('TAP', '15')

    // Invariant T002: voorraad > 0 ⇒ geen hint, ongeacht besteld.
    expect(result).toEqual({ status: 'geen_inkoop' })
    expect(maybeSingleMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('fetchVoorraadpositie retourneert null → geen_inkoop', async () => {
    fetchVoorraadpositieMock.mockResolvedValueOnce(null)

    const result = await fetchMaatwerkLevertijdHint('', '15')

    expect(result).toEqual({ status: 'geen_inkoop' })
  })

  it('issue #37: geen eigen voorraad, wel uitwisselbare partner → voorraad_uitwisselbaar', async () => {
    fetchVoorraadpositieMock.mockResolvedValueOnce(
      makePositie({
        totaal_m2: 0,
        beste_partner: {
          kwaliteit_code: 'TAP2',
          kleur_code: '15',
          rollen: 2,
          m2: 60,
        },
      }),
    )

    const result = await fetchMaatwerkLevertijdHint('TAP', '15')

    expect(result).toEqual({
      status: 'voorraad_uitwisselbaar',
      partner_kwaliteit: 'TAP2',
      partner_kleur: '15',
      partner_rollen: 2,
      partner_m2: 60,
    })
    // Geen onnodige config-/week-calls — partner-pad gaat niet door iso_week_plus.
    expect(maybeSingleMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('issue #37: uitwisselbare partner heeft voorrang op besteld-hint', async () => {
    fetchVoorraadpositieMock.mockResolvedValueOnce(
      makePositie({
        totaal_m2: 0,
        eerstvolgende_verwacht_datum: '2026-06-15',
        beste_partner: {
          kwaliteit_code: 'TAP2',
          kleur_code: '15',
          rollen: 1,
          m2: 30,
        },
      }),
    )

    const result = await fetchMaatwerkLevertijdHint('TAP', '15')

    // Partner-voorraad is ~direct; verkiezen boven wachten op IO.
    expect(result.status).toBe('voorraad_uitwisselbaar')
  })
})
