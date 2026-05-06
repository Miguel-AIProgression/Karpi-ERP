// Regression fixture 10 — `fetchGhostBesteldParen()` (T005, mig 183).
//
// Achtergrond: T005 verplaatst de directe `besteld_per_kwaliteit_kleur`-RPC-call
// uit `pages/rollen/rollen-overview.tsx` achter de Voorraadpositie-Module-seam.
// Deze test bewaakt:
//   1. RPC `besteld_per_kwaliteit_kleur` wordt exact één keer aangeroepen
//      (zonder argumenten — de RPC heeft geen parameters).
//   2. Raw rows worden gemapt naar `GhostBesteldRij`-shape — numerieke kolommen
//      via `Number()`, kleur_code genormaliseerd (`15.0` → `15`).
//   3. Bij RPC-fout retourneert lege array (niet-fatale fallback).
//
// Met deze seam in plaats kan `besteld_per_kwaliteit_kleur` als publieke RPC
// gedemoot worden in de zin "niet direct aanroepen vanuit nieuwe code" —
// alle frontend-toegang loopt nu via de Module.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: rpcMock },
}))

const { fetchGhostBesteldParen } = await import('../../queries/ghost-besteld')

beforeEach(() => {
  rpcMock.mockReset()
})

describe('fixture 10 — fetchGhostBesteldParen via Voorraadpositie-Module', () => {
  it('roept besteld_per_kwaliteit_kleur RPC één keer aan zonder argumenten', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null })

    await fetchGhostBesteldParen()

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('besteld_per_kwaliteit_kleur')
  })

  it('mapt raw rows naar GhostBesteldRij — numerieke casts + kleur-normalisatie', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          kwaliteit_code: 'TAP',
          // Kleur in raw-data komt soms met '.0' suffix — moet genormaliseerd
          // worden om te matchen op de Module's batch-respons.
          kleur_code: '15.0',
          // Numeriek-als-string is normaal voor Postgres NUMERIC over RPC.
          besteld_m: '120.5',
          besteld_m2: '482.0',
          orders_count: '3',
          eerstvolgende_leverweek: '2026-W22',
          eerstvolgende_verwacht_datum: '2026-06-01',
          eerstvolgende_m: '40.0',
          eerstvolgende_m2: '160.0',
        },
      ],
      error: null,
    })

    const result = await fetchGhostBesteldParen()

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      kwaliteit_code: 'TAP',
      kleur_code: '15',
      besteld_m: 120.5,
      besteld_m2: 482,
      orders_count: 3,
      eerstvolgende_leverweek: '2026-W22',
      eerstvolgende_verwacht_datum: '2026-06-01',
      eerstvolgende_m: 40,
      eerstvolgende_m2: 160,
    })
  })

  it('retourneert lege array bij RPC-fout (niet-fatale fallback)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'function does not exist' },
    })

    const result = await fetchGhostBesteldParen()

    expect(result).toEqual([])
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('mapt null-numerieken naar 0 (geen NaN in de UI)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          kwaliteit_code: 'LAMI',
          kleur_code: '15',
          besteld_m: null,
          besteld_m2: null,
          orders_count: null,
          eerstvolgende_leverweek: null,
          eerstvolgende_verwacht_datum: null,
          eerstvolgende_m: null,
          eerstvolgende_m2: null,
        },
      ],
      error: null,
    })

    const result = await fetchGhostBesteldParen()

    expect(result[0].besteld_m).toBe(0)
    expect(result[0].besteld_m2).toBe(0)
    expect(result[0].orders_count).toBe(0)
    expect(result[0].eerstvolgende_m).toBe(0)
    expect(result[0].eerstvolgende_m2).toBe(0)
  })
})
