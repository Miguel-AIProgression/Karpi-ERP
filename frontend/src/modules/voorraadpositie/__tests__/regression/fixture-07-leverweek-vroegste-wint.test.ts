// Regression fixture 07 — Invariant 8: bij meerdere openstaande IO-regels
// per (kw, kl) wint de vroegste verwacht_datum (en bijbehorende leverweek)
// in de output.
//
// De SQL-aggregatie (mig 137 → mig 179/180) gebeurt in besteld_per_kwaliteit_kleur():
// `DISTINCT ON (kwaliteit, kleur) ... ORDER BY verwacht_datum ASC`. Deze test
// borgt dat de TS-mapper de pre-geaggregeerde respons 1-op-1 doorgeeft.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: rpcMock },
}))

const { fetchVoorraadpositie } = await import('../../queries/voorraadposities')

beforeEach(() => {
  rpcMock.mockReset()
})

describe('fixture 07 — leverweek-aggregatie: vroegste verwacht_datum wint', () => {
  it('respons toont de vroegste verwacht_datum + bijbehorende leverweek', async () => {
    // SQL heeft al geaggregeerd: 2026-05-25 (W22) is vroeger dan 2026-06-08 (W24).
    // De totalen tellen alle openstaande regels op (besteld_m = 80 = 30 + 50);
    // de "eerstvolgende_*"-velden tonen de vroegste leverweek (m=30, m²=120).
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
          partners: [],
          beste_partner: null,
          besteld_m: 80,
          besteld_m2: 320,
          besteld_orders_count: 2,
          // Vroegste regel: 2026-W22 / 2026-05-25 (niet W24 / 2026-06-08).
          eerstvolgende_leverweek: '2026-W22',
          eerstvolgende_verwacht_datum: '2026-05-25',
          eerstvolgende_m: 30,
          eerstvolgende_m2: 120,
        },
      ],
      error: null,
    })

    const positie = await fetchVoorraadpositie('TAP', '15')

    expect(positie).not.toBeNull()
    // Eerstvolgende regel reflecteert de vroegste verwacht_datum.
    expect(positie!.besteld.eerstvolgende_verwacht_datum).toBe('2026-05-25')
    expect(positie!.besteld.eerstvolgende_leverweek).toBe('2026-W22')
    expect(positie!.besteld.eerstvolgende_m).toBe(30)
    expect(positie!.besteld.eerstvolgende_m2).toBe(120)
    // Totalen omvatten beide IO-regels.
    expect(positie!.besteld.besteld_m).toBe(80)
    expect(positie!.besteld.besteld_m2).toBe(320)
    expect(positie!.besteld.orders_count).toBe(2)
    // Eerstvolgend deel-aantal is altijd ≤ totaal.
    expect(positie!.besteld.eerstvolgende_m).toBeLessThanOrEqual(
      positie!.besteld.besteld_m,
    )
  })
})
