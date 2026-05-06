// Regression fixture 08 — Invariant 9: partners is een (mogelijk lege)
// JSONB-array, nooit NULL.
//
// SQL-laag (mig 179/180) wraps `jsonb_agg(...)` in `COALESCE(..., '[]'::jsonb)`.
// Deze test borgt dat de TS-mapper:
//   * een lege array correct doorgeeft als `[]`,
//   * NIET stilzwijgend `null` of `undefined` lekt.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: rpcMock },
}))

const { fetchVoorraadpositie } = await import('../../queries/voorraadposities')

beforeEach(() => {
  rpcMock.mockReset()
})

describe('fixture 08 — partners is array (niet null) zonder uitwisselgroep-leden', () => {
  it("partners=[] (lege jsonb-array) ⇒ positie.partners is Array.isArray, lengte 0", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          kwaliteit_code: 'TAP',
          kleur_code: '15',
          product_naam: 'TAP 15',
          eigen_volle_rollen: 1,
          eigen_aangebroken_rollen: 0,
          eigen_reststuk_rollen: 0,
          eigen_totaal_m2: 40,
          rollen: [],
          partners: [],
          beste_partner: null,
          besteld_m: 0,
          besteld_m2: 0,
          besteld_orders_count: 0,
          eerstvolgende_leverweek: null,
          eerstvolgende_verwacht_datum: null,
          eerstvolgende_m: 0,
          eerstvolgende_m2: 0,
        },
      ],
      error: null,
    })

    const positie = await fetchVoorraadpositie('TAP', '15')

    expect(positie).not.toBeNull()
    expect(Array.isArray(positie!.partners)).toBe(true)
    expect(positie!.partners).toHaveLength(0)
    expect(positie!.partners).not.toBeNull()
    expect(positie!.partners).not.toBeUndefined()
  })

  it('partners=null (defensief) ⇒ mapper levert lege array, geen null', async () => {
    // Defensief: zelfs als de RPC ondanks COALESCE alsnog null zou
    // teruggeven, moet de mapper niet crashen of null doorgeven.
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          kwaliteit_code: 'TAP',
          kleur_code: '15',
          product_naam: 'TAP 15',
          eigen_volle_rollen: 0,
          eigen_aangebroken_rollen: 0,
          eigen_reststuk_rollen: 0,
          eigen_totaal_m2: 0,
          rollen: null,
          partners: null,
          beste_partner: null,
          besteld_m: 0,
          besteld_m2: 0,
          besteld_orders_count: 0,
          eerstvolgende_leverweek: null,
          eerstvolgende_verwacht_datum: null,
          eerstvolgende_m: 0,
          eerstvolgende_m2: 0,
        },
      ],
      error: null,
    })

    const positie = await fetchVoorraadpositie('TAP', '15')

    expect(positie).not.toBeNull()
    expect(Array.isArray(positie!.partners)).toBe(true)
    expect(positie!.partners).toHaveLength(0)
    expect(Array.isArray(positie!.rollen)).toBe(true)
    expect(positie!.rollen).toHaveLength(0)
  })
})
