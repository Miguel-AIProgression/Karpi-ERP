// Mig 575: updateProduct() moet een voorraad-wijziging via RPC
// corrigeer_voorraad_handmatig laten lopen (logt het delta voor de
// Basta-import) i.p.v. een kale kolom-update — en de overige velden
// gewoon via de normale .update() blijven sturen.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn().mockResolvedValue({ error: null })
const eq = vi.fn().mockResolvedValue({ error: null })
const update = vi.fn((_payload: Record<string, unknown>) => ({ eq }))
const from = vi.fn(() => ({ update }))

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc, from },
}))

const { updateProduct } = await import('../producten')

beforeEach(() => {
  rpc.mockClear()
  eq.mockClear()
  update.mockClear()
  from.mockClear()
})

describe('updateProduct — voorraad via RPC (mig 575)', () => {
  it('roept corrigeer_voorraad_handmatig aan en laat voorraad uit de kale update', async () => {
    await updateProduct('123', { voorraad: 9 })

    expect(rpc).toHaveBeenCalledWith('corrigeer_voorraad_handmatig', {
      p_artikelnr: '123',
      p_nieuwe_voorraad: 9,
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('stuurt overige velden nog gewoon via .update(), zonder voorraad erin', async () => {
    await updateProduct('123', { voorraad: 9, omschrijving: 'Nieuwe naam' })

    expect(rpc).toHaveBeenCalledWith('corrigeer_voorraad_handmatig', {
      p_artikelnr: '123',
      p_nieuwe_voorraad: 9,
    })
    expect(update).toHaveBeenCalledTimes(1)
    const payload = update.mock.calls[0][0]
    expect(payload).not.toHaveProperty('voorraad')
    expect(payload).toMatchObject({ omschrijving: 'Nieuwe naam' })
  })

  it('zonder voorraad-veld: geen RPC-call, gewone update', async () => {
    await updateProduct('123', { omschrijving: 'Nieuwe naam' })

    expect(rpc).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
  })
})
