// Regression fixture 05 — Invariant 5: partners-sortering m² DESC, dan
// kwaliteit_code ASC, dan kleur_code ASC.
//
// SQL-laag (mig 179/180) sorteert in `jsonb_agg(... ORDER BY p_m2 DESC,
// p_kw ASC, p_kl ASC)`. Deze test borgt dat de TS-mapper de volgorde 1-op-1
// doorgeeft (geen reverse, geen alfabetische re-sort).

import { describe, it, expect, beforeEach, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: rpcMock },
}))

const { fetchVoorraadpositie } = await import('../../queries/voorraadposities')

beforeEach(() => {
  rpcMock.mockReset()
})

describe('fixture 05 — partners-sortering m² DESC, kw ASC, kl ASC', () => {
  it('m² DESC dominant, dan kw ASC bij gelijke m²', async () => {
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
          rollen: [],
          // Volgorde zoals SQL ze al gesorteerd levert: m² DESC dominant, dan
          // kw ASC. {C, m²=20} > {A, m²=10} > {B, m²=10}.
          partners: [
            { kwaliteit_code: 'C', kleur_code: '15', rollen: 1, m2: 20 },
            { kwaliteit_code: 'A', kleur_code: '15', rollen: 1, m2: 10 },
            { kwaliteit_code: 'B', kleur_code: '15', rollen: 1, m2: 10 },
          ],
          beste_partner: { kwaliteit_code: 'C', kleur_code: '15', rollen: 1, m2: 20 },
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
    expect(positie!.partners).toHaveLength(3)
    // m² DESC dominant: C (m²=20) komt vóór A en B (m²=10).
    expect(positie!.partners[0].kwaliteit_code).toBe('C')
    expect(positie!.partners[0].m2).toBe(20)
    // Tussen A en B (gelijke m²): kw ASC ⇒ A vóór B.
    expect(positie!.partners[1].kwaliteit_code).toBe('A')
    expect(positie!.partners[2].kwaliteit_code).toBe('B')
  })

  it('kleur_code ASC als secundair bij gelijke m² + kw', async () => {
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
          rollen: [],
          // Zelfde kw=A, gelijke m²=10. SQL sorteert op kleur_code ASC ⇒
          // '11' vóór '99'.
          partners: [
            { kwaliteit_code: 'A', kleur_code: '11', rollen: 1, m2: 10 },
            { kwaliteit_code: 'A', kleur_code: '99', rollen: 1, m2: 10 },
          ],
          beste_partner: { kwaliteit_code: 'A', kleur_code: '11', rollen: 1, m2: 10 },
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
    expect(positie!.partners).toHaveLength(2)
    expect(positie!.partners[0].kleur_code).toBe('11')
    expect(positie!.partners[1].kleur_code).toBe('99')
  })
})
