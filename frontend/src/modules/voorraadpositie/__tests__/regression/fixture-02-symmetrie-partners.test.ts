// Regression fixture 02 — Invariant 2: symmetrie tussen partner-paren.
//
// Wanneer (TAP, 15) als partner (LAMI, 15) heeft, dan moet (LAMI, 15) ook
// (TAP, 15) als partner hebben. SQL-laag krijgt dit cadeau van uitwisselbare_
// partners() (zelfjoin op kwaliteit_kleur_uitwisselgroepen.basis_code +
// variant_nr); deze test bewaakt dat de TS-mapper de symmetrische partner-shapes
// niet stilzwijgend filtert of mismatcht.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: rpcMock },
}))

const { fetchVoorraadpositie } = await import('../../queries/voorraadposities')

beforeEach(() => {
  rpcMock.mockReset()
})

describe('fixture 02 — symmetrie partners (A heeft B ⇔ B heeft A)', () => {
  it('twee opeenvolgende calls retourneren elkaars wederzijdse partner-shape', async () => {
    // Call 1: (TAP, 15) → partner (LAMI, 15)
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
          partners: [
            { kwaliteit_code: 'LAMI', kleur_code: '15', rollen: 2, m2: 80 },
          ],
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

    // Call 2: (LAMI, 15) → partner (TAP, 15)
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          kwaliteit_code: 'LAMI',
          kleur_code: '15',
          product_naam: 'LAMI 15',
          eigen_volle_rollen: 2,
          eigen_aangebroken_rollen: 0,
          eigen_reststuk_rollen: 0,
          eigen_totaal_m2: 80,
          rollen: [],
          partners: [
            { kwaliteit_code: 'TAP', kleur_code: '15', rollen: 1, m2: 40 },
          ],
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

    const a = await fetchVoorraadpositie('TAP', '15')
    const b = await fetchVoorraadpositie('LAMI', '15')

    expect(a).not.toBeNull()
    expect(b).not.toBeNull()

    // A's partner is B
    expect(a!.partners).toHaveLength(1)
    expect(a!.partners[0].kwaliteit_code).toBe(b!.kwaliteit_code)
    expect(a!.partners[0].kleur_code).toBe(b!.kleur_code)

    // B's partner is A
    expect(b!.partners).toHaveLength(1)
    expect(b!.partners[0].kwaliteit_code).toBe(a!.kwaliteit_code)
    expect(b!.partners[0].kleur_code).toBe(a!.kleur_code)

    // Wederzijdse m²-cijfers reflecteren elkaars eigen_totaal_m2
    expect(a!.partners[0].m2).toBe(b!.voorraad.totaal_m2)
    expect(b!.partners[0].m2).toBe(a!.voorraad.totaal_m2)
  })
})
