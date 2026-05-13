// Contract-test voor Levertijd-Module maatwerk-capaciteit-RPC's (mig 278).
//
// Pattern overgenomen van levertijd-queries.contract.test.ts: we mocken de
// Supabase-client en valideren dat fetchFitCheck / fetchSnelsteHaalbaar de
// juiste *RPC-call shape* maken én de juiste *result shape* parsen.
//
// Scope: aannames over wat mig 278 retourneert voor maatwerk-regels.
// Geen DB-integratietest — de SQL-ASSERT in mig 278 dekt dat al af.
// Deze test fixeert het Frontend↔SQL contract zodat een toekomstige
// SQL-refactor (productie_groep-uitbreiding, V2-confectie) niet stilletjes
// de result-shape breekt.

import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchFitCheck, fetchSnelsteHaalbaar } from '../queries/levertijd'
import type {
  FitCheckResultaat,
  SnelsteHaalbaarResultaat,
} from '../types'

let rpcCalls: Array<{ fn: string; args: unknown }> = []
let nextRpcResponse: { data: unknown; error: unknown } = { data: null, error: null }

function makeFakeClient(): SupabaseClient {
  return {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve(nextRpcResponse)
    },
  } as unknown as SupabaseClient
}

beforeEach(() => {
  rpcCalls = []
  nextRpcResponse = { data: null, error: null }
})

describe('mig 278 maatwerk-fit-check — contract', () => {
  // ----------------------------------------------------------------
  // Scenario 1: maatwerk-regel, gewenste week heeft ruimte → haalbaar=TRUE
  // ----------------------------------------------------------------
  it('scenario 1: maatwerk-regel met ruimte in gewenste week → haalbaar TRUE, reden NULL', async () => {
    const fixture: FitCheckResultaat[] = [
      {
        regel_id: 1001,
        haalbaar: true,
        reden: null,
        eerstvolgend_haalbaar: '2026-W25',
      },
    ]
    nextRpcResponse = { data: fixture, error: null }

    const result = await fetchFitCheck(makeFakeClient(), [1001], '2026-W25')

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].fn).toBe('levertijd_fit_check')
    expect(rpcCalls[0].args).toEqual({
      p_regel_ids: [1001],
      p_gewenste_week: '2026-W25',
    })
    expect(result).toHaveLength(1)
    expect(result[0].haalbaar).toBe(true)
    expect(result[0].reden).toBeNull()
    expect(result[0].eerstvolgend_haalbaar).toBe('2026-W25')
  })

  // ----------------------------------------------------------------
  // Scenario 2: maatwerk-regel, gewenste week vol → haalbaar=FALSE met
  // alternatieve week
  // ----------------------------------------------------------------
  it('scenario 2: maatwerk-regel, capaciteit vol in gewenste week → eerstvolgend_haalbaar wijst naar latere week', async () => {
    const fixture: FitCheckResultaat[] = [
      {
        regel_id: 1002,
        haalbaar: false,
        reden: 'snij-capaciteit vol in week 2026-W25',
        eerstvolgend_haalbaar: '2026-W27',
      },
    ]
    nextRpcResponse = { data: fixture, error: null }

    const result = await fetchFitCheck(makeFakeClient(), [1002], '2026-W25')

    expect(result[0].haalbaar).toBe(false)
    expect(result[0].reden).toContain('snij-capaciteit vol')
    // Eerstvolgend moet strikt later vallen dan gewenst (lexicografisch op ISO-week-string)
    expect(result[0].eerstvolgend_haalbaar!.localeCompare('2026-W25')).toBeGreaterThan(0)
  })

  // ----------------------------------------------------------------
  // Scenario 3: snelste_haalbaar maatwerk — capaciteit deze week (spoed-slot)
  // ----------------------------------------------------------------
  it('scenario 3: maatwerk snelste_haalbaar met ruimte in huidige week → spoed-slot uitleg', async () => {
    const fixture: SnelsteHaalbaarResultaat[] = [
      {
        regel_id: 2001,
        snelste_haalbaar: '2026-W19',
        spoed_uitleg: 'spoed-slot: capaciteit beschikbaar deze week',
      },
    ]
    nextRpcResponse = { data: fixture, error: null }

    const result = await fetchSnelsteHaalbaar(makeFakeClient(), [2001])

    expect(rpcCalls[0].fn).toBe('levertijd_snelste_haalbaar')
    expect(rpcCalls[0].args).toEqual({ p_regel_ids: [2001] })
    expect(result[0].snelste_haalbaar).toMatch(/^\d{4}-W\d{2}$/)
    expect(result[0].spoed_uitleg).toContain('spoed-slot')
  })

  // ----------------------------------------------------------------
  // Scenario 4: snelste_haalbaar maatwerk — eerste vrije week N-vooruit
  // ----------------------------------------------------------------
  it('scenario 4: maatwerk snelste_haalbaar — alle vroege weken vol, valt op week N-vooruit', async () => {
    const fixture: SnelsteHaalbaarResultaat[] = [
      {
        regel_id: 2002,
        snelste_haalbaar: '2026-W23',
        spoed_uitleg: 'eerstvolgende vrije snij-week (4 weken vooruit)',
      },
    ]
    nextRpcResponse = { data: fixture, error: null }

    const result = await fetchSnelsteHaalbaar(makeFakeClient(), [2002])

    expect(result[0].snelste_haalbaar).toMatch(/^\d{4}-W\d{2}$/)
    expect(result[0].spoed_uitleg).toContain('eerstvolgende vrije snij-week')
    expect(result[0].spoed_uitleg).toContain('weken vooruit')
  })

  // ----------------------------------------------------------------
  // Scenario 5: snelste_haalbaar maatwerk — 12-week-horizon volledig vol →
  // pessimistische fallback (2 weken vooruit + uitleg)
  // ----------------------------------------------------------------
  it('scenario 5: maatwerk snelste_haalbaar — alle 12 weken vol → pessimistische fallback', async () => {
    const fixture: SnelsteHaalbaarResultaat[] = [
      {
        regel_id: 2003,
        snelste_haalbaar: '2026-W21',
        spoed_uitleg: 'snij-planning vol komende 12 weken — pessimistische schatting',
      },
    ]
    nextRpcResponse = { data: fixture, error: null }

    const result = await fetchSnelsteHaalbaar(makeFakeClient(), [2003])

    expect(result[0].snelste_haalbaar).not.toBeNull()
    expect(result[0].spoed_uitleg).toContain('pessimistische schatting')
  })

  // ----------------------------------------------------------------
  // Scenario 6: batch maatwerk + voorraad gemengd
  // ----------------------------------------------------------------
  it('scenario 6: batch met maatwerk + voorraad → beide regels in resultaat met juiste shape', async () => {
    const fixture: FitCheckResultaat[] = [
      {
        regel_id: 3001,
        haalbaar: true,
        reden: 'voorraad',
        eerstvolgend_haalbaar: '2026-W25',
      },
      {
        regel_id: 3002,
        haalbaar: true,
        reden: null,
        eerstvolgend_haalbaar: '2026-W25',
      },
    ]
    nextRpcResponse = { data: fixture, error: null }

    const result = await fetchFitCheck(makeFakeClient(), [3001, 3002], '2026-W25')

    expect(result).toHaveLength(2)
    expect(result.find((r) => r.regel_id === 3001)?.reden).toBe('voorraad')
    expect(result.find((r) => r.regel_id === 3002)?.reden).toBeNull()
  })
})
