// Regression fixture 03 — Invariant 4: kleur-normalisatie.
//
// '15.0' / '15.00' / '15' moeten allemaal als kleur '15' uitkomen, zowel
// in de helper-functie als in de fetcher (zowel in de RPC-input als in
// de respons-mapping van partner-kleuren).
//
// Plus: lege string voor kw of kl ⇒ fetchVoorraadpositie returnt null
// ZONDER supabase.rpc-call (verifieer call-count = 0).

import { describe, it, expect, beforeEach, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: rpcMock },
}))

const { fetchVoorraadpositie, normaliseerKleurcode } = await import('../../index')

beforeEach(() => {
  rpcMock.mockReset()
})

describe('fixture 03 — kleur-normalisatie', () => {
  it('normaliseerKleurcode strip trailing .0+', () => {
    expect(normaliseerKleurcode('15.0')).toBe('15')
    expect(normaliseerKleurcode('15.00')).toBe('15')
    expect(normaliseerKleurcode('15')).toBe('15')
    // Edge: alleen trailing .0+ wordt gestript, niet alle decimalen.
    expect(normaliseerKleurcode('15.5')).toBe('15.5')
    // Edge: lege string blijft leeg.
    expect(normaliseerKleurcode('')).toBe('')
  })

  it('fetchVoorraadpositie geeft genormaliseerde kleur door aan RPC en in respons', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          kwaliteit_code: 'TAP',
          kleur_code: '15.0', // RPC zou dit normaal genormaliseerd retourneren,
                              // maar als verdediging in-depth canonicaliseert
                              // de TS-mapper opnieuw.
          eigen_volle_rollen: 0,
          eigen_aangebroken_rollen: 0,
          eigen_reststuk_rollen: 0,
          eigen_totaal_m2: 0,
          partners: [
            // Partner-kleurcode komt mogelijk uit een andere kolom — mapper
            // moet ook die normaliseren.
            { kwaliteit_code: 'LAMI', kleur_code: '15.00', rollen: 1, m2: 40 },
          ],
          beste_partner: { kwaliteit_code: 'LAMI', kleur_code: '15.00', rollen: 1, m2: 40 },
          besteld_m: 0,
          besteld_m2: 0,
          besteld_orders_count: 0,
          eerstvolgende_leverweek: null,
          eerstvolgende_verwacht_datum: null,
        },
      ],
      error: null,
    })

    const positie = await fetchVoorraadpositie('TAP', '15.0')

    // Caller heeft kleur als '15.0' geleverd — RPC moet '15' krijgen.
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith(
      'voorraadposities',
      expect.objectContaining({
        p_kwaliteit: 'TAP',
        p_kleur: '15',
        p_search: null,
      }),
    )

    // Respons-mapping normaliseert ook de kleurvelden.
    expect(positie).not.toBeNull()
    expect(positie!.kleur_code).toBe('15')
    expect(positie!.partners[0].kleur_code).toBe('15')
    expect(positie!.beste_partner!.kleur_code).toBe('15')
  })

  it("fetchVoorraadpositie('TAP', '') retourneert null zonder rpc-call", async () => {
    const result = await fetchVoorraadpositie('TAP', '')
    expect(result).toBeNull()
    expect(rpcMock).toHaveBeenCalledTimes(0)
  })

  it("fetchVoorraadpositie('', '15') retourneert null zonder rpc-call", async () => {
    const result = await fetchVoorraadpositie('', '15')
    expect(result).toBeNull()
    expect(rpcMock).toHaveBeenCalledTimes(0)
  })
})
