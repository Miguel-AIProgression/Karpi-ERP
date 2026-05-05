// Consumer-side contract test: orders-module → planning-seam.
//
// Doel: verifiëren dat de orders-module de planning-seam correct kan aanroepen
// en dat de types kloppen zoals de consumer ze verwacht.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MaatwerkRegelConcept, SeamResult, PerRegelScenario } from '@/modules/planning'
import { simuleerLevertijd } from '@/modules/planning'

// Mock de Supabase-client — geen echte HTTP-aanroepen.
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}))

import { supabase } from '@/lib/supabase/client'

// ---------------------------------------------------------------------------
// Gedeelde fixture
// ---------------------------------------------------------------------------

const regelFixture: MaatwerkRegelConcept = {
  regel_id: 'rule-1',
  kwaliteit_code: 'FREZ',
  kleur_code: '50',
  lengte_cm: 200,
  breedte_cm: 140,
  vorm: 'rechthoek',
  gewenste_leverdatum: '2026-06-01',
}

const scenarioFixture: PerRegelScenario = {
  regel_id: 'rule-1',
  scenario: 'match_bestaande_rol',
  snij_datum: '2026-05-20',
  lever_datum: '2026-05-22',
  spoed_toeslag_bedrag: null,
  onderbouwing: 'Passende rol gevonden in week 21.',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('planning-seam — consumer (orders-module)', () => {
  it('exporteert simuleerLevertijd als aanroepbare functie', () => {
    expect(typeof simuleerLevertijd).toBe('function')
  })

  it('retourneert SeamResult met ok: true bij succesvolle edge-function', async () => {
    const successResult: SeamResult = { ok: true, scenarios: [scenarioFixture] }
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: successResult, error: null })

    const result = await simuleerLevertijd([regelFixture])

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.scenarios).toHaveLength(1)
    expect(result.scenarios[0].regel_id).toBe('rule-1')
  })

  it('retourneert SeamResult met ok: false bij een fout-response', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null,
      error: { message: 'timeout' },
    })

    const result = await simuleerLevertijd([regelFixture])

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error).toBe('planning_unavailable')
    expect(result.message).toBeTruthy()
  })

  it('retourneert invalid_input bij lege input (geen HTTP-aanroep)', async () => {
    const result = await simuleerLevertijd([])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('invalid_input')
    expect(supabase.functions.invoke).not.toHaveBeenCalled()
  })

  it('stuurt de regels door als body naar de edge-functie', async () => {
    const successResult: SeamResult = { ok: true, scenarios: [scenarioFixture] }
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: successResult, error: null })

    await simuleerLevertijd([regelFixture])

    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'planning-simuleer-levertijd',
      { body: { regels: [regelFixture] } },
    )
  })

  // Discriminated-union shape checks
  it('SeamResult ok:true heeft het scenarios-veld', () => {
    const ok: SeamResult = { ok: true, scenarios: [] }
    expect(ok).toMatchObject({ ok: true, scenarios: [] })
  })

  it('SeamResult ok:false heeft error en message', () => {
    const fail: SeamResult = {
      ok: false,
      error: 'planning_unavailable',
      message: 'service onbereikbaar',
    }
    expect(fail.ok).toBe(false)
    expect(fail.error).toBe('planning_unavailable')
    expect(fail.message).toBeTypeOf('string')
  })

  it('PerRegelScenario heeft alle verplichte velden', () => {
    const s: PerRegelScenario = scenarioFixture
    expect(s.regel_id).toBeTypeOf('string')
    expect(s.scenario).toBeTypeOf('string')
    expect(s.onderbouwing).toBeTypeOf('string')
    // snij_datum en lever_datum mogen null zijn
    expect([null, 'string']).toContain(s.snij_datum === null ? null : typeof s.snij_datum)
    expect([null, 'string']).toContain(s.lever_datum === null ? null : typeof s.lever_datum)
  })
})
