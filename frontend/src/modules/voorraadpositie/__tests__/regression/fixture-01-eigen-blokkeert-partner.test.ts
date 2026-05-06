// Regression fixture 01 — Invariant 1: eigen voorraad > 0 ⇒ beste_partner === null.
//
// De allocator mag GEEN uitwissel-suggestie geven zolang we zelf nog rollen
// hebben. Deze test bewaakt dat fetchVoorraadpositie correct de SQL-RPC-output
// doorgeeft: zelfs als de RPC een (theoretisch) `beste_partner` null teruggeeft
// terwijl `partners[0]` gevuld is, blijft het mapping-resultaat null.
//
// SQL-laag handhaaft de invariant via CASE; deze test borgt dat de TS-mapper
// niet alsnog naar partners[0] grijpt.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: rpcMock },
}))

const { fetchVoorraadpositie } = await import('../../queries/voorraadposities')

beforeEach(() => {
  rpcMock.mockReset()
})

describe('fixture 01 — eigen voorraad blokkeert beste_partner', () => {
  it('eigen_totaal_m2 > 0 ⇒ beste_partner === null, partners blijven gevuld', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          kwaliteit_code: 'TAP',
          kleur_code: '15',
          eigen_volle_rollen: 2,
          eigen_aangebroken_rollen: 1,
          eigen_reststuk_rollen: 0,
          eigen_totaal_m2: 80,
          partners: [
            { kwaliteit_code: 'LAMI', kleur_code: '15', rollen: 3, m2: 120 },
          ],
          // RPC zet beste_partner=NULL omdat eigen_m2 > 0 (mig 179 CASE).
          beste_partner: null,
          besteld_m: 0,
          besteld_m2: 0,
          besteld_orders_count: 0,
          eerstvolgende_leverweek: null,
          eerstvolgende_verwacht_datum: null,
        },
      ],
      error: null,
    })

    const positie = await fetchVoorraadpositie('TAP', '15')

    expect(positie).not.toBeNull()
    expect(positie!.voorraad.totaal_m2).toBe(80)
    expect(positie!.partners).toHaveLength(1)
    expect(positie!.partners[0].kwaliteit_code).toBe('LAMI')
    // De kern-invariant:
    expect(positie!.beste_partner).toBeNull()
  })

  it('eigen_totaal_m2 = 0 EN partners[0].m2 > 0 ⇒ beste_partner === partners[0]', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          kwaliteit_code: 'TAP',
          kleur_code: '15',
          eigen_volle_rollen: 0,
          eigen_aangebroken_rollen: 0,
          eigen_reststuk_rollen: 0,
          eigen_totaal_m2: 0,
          partners: [
            { kwaliteit_code: 'LAMI', kleur_code: '15', rollen: 3, m2: 120 },
          ],
          beste_partner: { kwaliteit_code: 'LAMI', kleur_code: '15', rollen: 3, m2: 120 },
          besteld_m: 0,
          besteld_m2: 0,
          besteld_orders_count: 0,
          eerstvolgende_leverweek: null,
          eerstvolgende_verwacht_datum: null,
        },
      ],
      error: null,
    })

    const positie = await fetchVoorraadpositie('TAP', '15')

    expect(positie).not.toBeNull()
    expect(positie!.voorraad.totaal_m2).toBe(0)
    expect(positie!.beste_partner).not.toBeNull()
    expect(positie!.beste_partner!.kwaliteit_code).toBe('LAMI')
    expect(positie!.beste_partner!.m2).toBe(120)
  })
})
