// Regression fixture 06 — Invariant 6: bestaans-asymmetrie batch vs single.
//
// SQL-laag (mig 180):
//   * Single-paar-modus retourneert óók ghost-paren (paren zonder eigen
//     voorraad maar met partners of besteld). Nodig voor product-detail /
//     maatwerk-hint.
//   * Batch-modus retourneert ALLEEN paren met eigen voorraad. Ghost-paren
//     moeten via een aparte mergestrategie aangevuld worden door de caller
//     (rollen-overzicht doet dat zelf).
//
// Deze fixture bewaakt beide kanten van de asymmetrie via gemockte RPC-respons.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: rpcMock },
}))

const { fetchVoorraadpositie, fetchVoorraadposities } = await import(
  '../../queries/voorraadposities'
)

beforeEach(() => {
  rpcMock.mockReset()
})

describe('fixture 06 — bestaans-asymmetrie batch vs single', () => {
  it('single-modus: ghost-paar (geen eigen voorraad, wel besteld) wordt teruggegeven', async () => {
    // SQL retourneert in single-modus de match — óók als eigen=0 en partners=[]
    // maar besteld_m > 0. Dit is wat product-detail nodig heeft om "Openstaande
    // inkooporders" te tonen op een product zonder eigen voorraad.
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          kwaliteit_code: 'TAP',
          kleur_code: '99',
          product_naam: 'TAP 99',
          eigen_volle_rollen: 0,
          eigen_aangebroken_rollen: 0,
          eigen_reststuk_rollen: 0,
          eigen_totaal_m2: 0,
          rollen: [],
          partners: [],
          beste_partner: null,
          besteld_m: 50,
          besteld_m2: 200,
          besteld_orders_count: 1,
          eerstvolgende_leverweek: '2026-W22',
          eerstvolgende_verwacht_datum: '2026-05-25',
          eerstvolgende_m: 50,
          eerstvolgende_m2: 200,
        },
      ],
      error: null,
    })

    const positie = await fetchVoorraadpositie('TAP', '99')

    expect(positie).not.toBeNull()
    expect(positie!.voorraad.totaal_m2).toBe(0)
    expect(positie!.besteld.besteld_m).toBe(50)
    expect(positie!.besteld.besteld_m2).toBe(200)
    expect(positie!.besteld.eerstvolgende_leverweek).toBe('2026-W22')
  })

  it('batch-modus: ghost-paar zit NIET in de respons', async () => {
    // SQL retourneert in batch-modus alleen paren met eigen voorraad.
    // Dus: TAP-15 (eigen=80) zit erin, ghost TAP-99 (eigen=0) niet.
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          kwaliteit_code: 'TAP',
          kleur_code: '15',
          product_naam: 'TAP 15',
          eigen_volle_rollen: 2,
          eigen_aangebroken_rollen: 0,
          eigen_reststuk_rollen: 0,
          eigen_totaal_m2: 80,
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

    const posities = await fetchVoorraadposities({})

    // Lengte = aantal paren-met-eigen-voorraad = 1. Ghost TAP-99 ontbreekt.
    expect(posities).toHaveLength(1)
    expect(posities[0].kwaliteit_code).toBe('TAP')
    expect(posities[0].kleur_code).toBe('15')
    expect(posities.find((p) => p.kleur_code === '99')).toBeUndefined()
  })
})
