// Regression fixture 09 — `fetchVoorraadposities({})` met lege filter:
//   * RPC moet aangeroepen worden met `p_kwaliteit: null, p_kleur: null,
//     p_search: null` (lege strings worden NIET als filter doorgegeven).
//   * Resultaat is altijd een array (kan leeg zijn als geen paren met eigen
//     voorraad bestaan).
//
// Deze test bewaakt dat caller-laag-filtering niet per ongeluk lege strings
// als filter-waarde doorgeeft (dat zou batch-modus toch in single-modus laten
// vallen of een onbedoelde substring-filter activeren).

import { describe, it, expect, beforeEach, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: rpcMock },
}))

const { fetchVoorraadposities } = await import('../../queries/voorraadposities')

beforeEach(() => {
  rpcMock.mockReset()
})

describe('fixture 09 — batch lege filter ⇒ alle params null, resultaat is array', () => {
  it('lege filter ⇒ RPC krijgt p_kwaliteit/p_kleur/p_search als null', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null })

    const result = await fetchVoorraadposities({})

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith(
      'voorraadposities',
      expect.objectContaining({
        p_kwaliteit: null,
        p_kleur: null,
        p_search: null,
      }),
    )
    // Resultaat is altijd een array, ook als leeg.
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(0)
  })

  it('lege strings in filter-velden worden ook als null doorgegeven', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null })

    await fetchVoorraadposities({ kwaliteit: '', kleur: '', search: '' })

    expect(rpcMock).toHaveBeenCalledWith(
      'voorraadposities',
      expect.objectContaining({
        p_kwaliteit: null,
        p_kleur: null,
        p_search: null,
      }),
    )
  })

  it('gevulde filter-velden worden gepasseerd, kleur wordt genormaliseerd', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null })

    await fetchVoorraadposities({ kwaliteit: 'TAP', kleur: '15.0', search: 'foo' })

    expect(rpcMock).toHaveBeenCalledWith(
      'voorraadposities',
      expect.objectContaining({
        p_kwaliteit: 'TAP',
        // Kleur wordt op caller-niveau genormaliseerd (defensief — SQL doet
        // hetzelfde zodat caller-cache-keys en SQL-filter consistent matchen).
        p_kleur: '15',
        p_search: 'foo',
      }),
    )
  })

  it('respons met meerdere rijen wordt als array doorgegeven', async () => {
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
        {
          kwaliteit_code: 'LAMI',
          kleur_code: '15',
          product_naam: 'LAMI 15',
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

    const result = await fetchVoorraadposities({})

    expect(result).toHaveLength(2)
    expect(result[0].kwaliteit_code).toBe('TAP')
    expect(result[1].kwaliteit_code).toBe('LAMI')
  })
})
