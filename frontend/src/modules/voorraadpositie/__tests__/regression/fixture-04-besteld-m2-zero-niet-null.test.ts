// Regression fixture 04 — Invariant 3: besteld_m2 = 0 (niet NULL) bij
// ontbrekende standaard_breedte_cm.
//
// SQL-laag (mig 137 → mig 179) gebruikt COALESCE(besteld_m2, 0). Mocht
// er ooit een edge zijn waar de RPC alsnog null teruggeeft, dan moet de
// TS-mapper niet stilzwijgend NaN/undefined doorgeven.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: rpcMock },
}))

const { fetchVoorraadpositie } = await import('../../queries/voorraadposities')

beforeEach(() => {
  rpcMock.mockReset()
})

describe('fixture 04 — besteld_m2 = 0 (niet null/undefined/NaN)', () => {
  it('RPC null voor besteld_m2 ⇒ mapping levert numeric 0', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          kwaliteit_code: 'TAP',
          kleur_code: '15',
          eigen_volle_rollen: 0,
          eigen_aangebroken_rollen: 0,
          eigen_reststuk_rollen: 0,
          eigen_totaal_m2: 0,
          partners: [],
          beste_partner: null,
          besteld_m: 30,
          // Ontbrekende standaard_breedte_cm op kwaliteit ⇒ besteld_m2 null.
          besteld_m2: null,
          besteld_orders_count: 1,
          eerstvolgende_leverweek: '2026-W22',
          eerstvolgende_verwacht_datum: '2026-05-25',
        },
      ],
      error: null,
    })

    const positie = await fetchVoorraadpositie('TAP', '15')

    expect(positie).not.toBeNull()
    expect(positie!.besteld.besteld_m).toBe(30)
    // De kern-invariant — geen null, geen undefined, geen NaN, gewoon 0.
    expect(positie!.besteld.besteld_m2).toBe(0)
    expect(positie!.besteld.besteld_m2).not.toBeNaN()
    expect(positie!.besteld.besteld_m2).not.toBeNull()
    expect(typeof positie!.besteld.besteld_m2).toBe('number')

    // De rest van de besteld-shape blijft consistent.
    expect(positie!.besteld.orders_count).toBe(1)
    expect(positie!.besteld.eerstvolgende_leverweek).toBe('2026-W22')
    expect(positie!.besteld.eerstvolgende_verwacht_datum).toBe('2026-05-25')
  })

  it('RPC string-numeriek (NUMERIC kolom) ⇒ mapping cast naar number', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          kwaliteit_code: 'TAP',
          kleur_code: '15',
          eigen_volle_rollen: '0',
          eigen_aangebroken_rollen: '0',
          eigen_reststuk_rollen: '0',
          eigen_totaal_m2: '0',
          partners: [],
          beste_partner: null,
          besteld_m: '30.50',
          besteld_m2: '122.00',
          besteld_orders_count: '2',
          eerstvolgende_leverweek: '2026-W22',
          eerstvolgende_verwacht_datum: '2026-05-25',
        },
      ],
      error: null,
    })

    const positie = await fetchVoorraadpositie('TAP', '15')

    expect(positie).not.toBeNull()
    expect(positie!.besteld.besteld_m).toBe(30.5)
    expect(positie!.besteld.besteld_m2).toBe(122)
    expect(positie!.besteld.orders_count).toBe(2)
    expect(typeof positie!.voorraad.totaal_m2).toBe('number')
  })
})
