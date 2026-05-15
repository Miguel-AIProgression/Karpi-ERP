import { describe, it, expect, beforeEach, vi } from 'vitest'

const rpcCalls: Array<{ fn: string; args: unknown }> = []
let nextRpcResponse: { data: unknown; error: unknown } = { data: null, error: null }

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve(nextRpcResponse)
    },
  },
}))

import { rolToevoegen, rolBewerken, rolVerwijderen } from '@/lib/supabase/queries/rollen'

beforeEach(() => {
  rpcCalls.length = 0
  nextRpcResponse = { data: null, error: null }
})

describe('rol-crud query-laag contract', () => {
  it('rolToevoegen roept rol_handmatig_toevoegen met juiste param-shape', async () => {
    nextRpcResponse = { data: [{ rol_id: 1, rolnummer: 'CORR-X-1' }], error: null }
    await rolToevoegen({
      artikelnr: 'X', rol_type: 'volle_rol', lengte_cm: 1500, breedte_cm: 400,
      locatie_id: null, in_magazijn_sinds: '2025-01-10', rolnummer: null,
      reden: 'telfout', medewerker: 'm',
    })
    expect(rpcCalls[0].fn).toBe('rol_handmatig_toevoegen')
    expect(rpcCalls[0].args).toEqual({
      p_artikelnr: 'X', p_rol_type: 'volle_rol', p_lengte_cm: 1500,
      p_breedte_cm: 400, p_locatie_id: null, p_in_magazijn_sinds: '2025-01-10',
      p_rolnummer: null, p_reden: 'telfout', p_medewerker: 'm',
    })
  })

  it('rolBewerken roept rol_handmatig_bewerken met juiste param-shape', async () => {
    await rolBewerken({
      rol_id: 7, lengte_cm: 1200, breedte_cm: 400, locatie_id: 3,
      status: 'beschikbaar', reden: 'meting', medewerker: 'm',
    })
    expect(rpcCalls[0].fn).toBe('rol_handmatig_bewerken')
    expect(rpcCalls[0].args).toEqual({
      p_rol_id: 7, p_lengte_cm: 1200, p_breedte_cm: 400, p_locatie_id: 3,
      p_status: 'beschikbaar', p_reden: 'meting', p_medewerker: 'm',
    })
  })

  it('rolVerwijderen roept rol_verwijderen met juiste param-shape', async () => {
    await rolVerwijderen({ rol_id: 9, reden: 'verlies', medewerker: 'm' })
    expect(rpcCalls[0].fn).toBe('rol_verwijderen')
    expect(rpcCalls[0].args).toEqual({
      p_rol_id: 9, p_reden: 'verlies', p_medewerker: 'm',
    })
  })

  it('propageert Supabase-fout als Error', async () => {
    nextRpcResponse = { data: null, error: { message: 'Rolnummer X bestaat al.' } }
    await expect(
      rolVerwijderen({ rol_id: 1, reden: 'x', medewerker: 'm' }),
    ).rejects.toThrow('Rolnummer X bestaat al.')
  })
})
