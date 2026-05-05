// Provider-side contract test: planning-module implementeert de seam correct.
//
// Doel: verifiëren dat de planning-module de types correct exporteert en dat
// simuleerLevertijd de afgesproken SeamResult-shape teruggeeft.

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
// Gedeelde fixture (identiek aan consumer-side)
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
  scenario: 'nieuwe_rol_gepland',
  snij_datum: '2026-05-26',
  lever_datum: '2026-05-28',
  spoed_toeslag_bedrag: null,
  onderbouwing: 'Nieuwe rol inplannen in week 22; voldoende capaciteit.',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('planning-seam — provider (planning-module)', () => {
  // Type-exports
  it('exporteert MaatwerkRegelConcept via barrel', () => {
    // Compile-time check: fixture wordt geaccepteerd als MaatwerkRegelConcept.
    const r: MaatwerkRegelConcept = regelFixture
    expect(r.regel_id).toBe('rule-1')
  })

  it('exporteert PerRegelScenario via barrel', () => {
    const s: PerRegelScenario = scenarioFixture
    expect(s.scenario).toBe('nieuwe_rol_gepland')
  })

  it('exporteert SeamResult als discriminated union via barrel', () => {
    const ok: SeamResult = { ok: true, scenarios: [] }
    const fail: SeamResult = { ok: false, error: 'invalid_input', message: 'slecht verzoek' }
    expect(ok.ok).toBe(true)
    expect(fail.ok).toBe(false)
  })

  // simuleerLevertijd succes-pad
  it('retourneert { ok: true, scenarios } bij succesvolle edge-functie', async () => {
    const edgeResponse: SeamResult = { ok: true, scenarios: [scenarioFixture] }
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: edgeResponse, error: null })

    const result = await simuleerLevertijd([regelFixture])

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.scenarios).toHaveLength(1)
    const s = result.scenarios[0]
    expect(s.regel_id).toBe('rule-1')
    expect(s.scenario).toBe('nieuwe_rol_gepland')
    expect(s.snij_datum).toBe('2026-05-26')
    expect(s.lever_datum).toBe('2026-05-28')
    expect(s.spoed_toeslag_bedrag).toBeNull()
    expect(s.onderbouwing).toBeTypeOf('string')
  })

  // simuleerLevertijd fout-pad: netwerkfout
  it('retourneert { ok: false, error: planning_unavailable } bij netwerk-fout', async () => {
    vi.mocked(supabase.functions.invoke).mockRejectedValue(new Error('network failure'))

    const result = await simuleerLevertijd([regelFixture])

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error).toBe('planning_unavailable')
    expect(result.message).toContain('network failure')
  })

  // simuleerLevertijd fout-pad: edge-functie retourneert error-object
  it('retourneert { ok: false } wanneer de edge-functie een error geeft', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null,
      error: { message: 'function crashed' },
    })

    const result = await simuleerLevertijd([regelFixture])

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error).toBe('planning_unavailable')
  })

  // simuleerLevertijd fout-pad: lege data
  it('retourneert { ok: false } bij null data en geen error', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: null, error: null })

    const result = await simuleerLevertijd([regelFixture])

    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error).toBe('planning_unavailable')
  })

  // Meerdere regels
  it('geeft een scenario terug per ingevoerde regel', async () => {
    const regel2: MaatwerkRegelConcept = {
      ...regelFixture,
      regel_id: 'rule-2',
      lengte_cm: 300,
    }
    const edgeResponse: SeamResult = {
      ok: true,
      scenarios: [
        scenarioFixture,
        { ...scenarioFixture, regel_id: 'rule-2', snij_datum: '2026-05-27', lever_datum: '2026-05-29' },
      ],
    }
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: edgeResponse, error: null })

    const result = await simuleerLevertijd([regelFixture, regel2])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scenarios).toHaveLength(2)
    expect(result.scenarios.map((s) => s.regel_id)).toEqual(['rule-1', 'rule-2'])
  })

  // Alle geldige scenario-waarden
  it.each([
    'match_bestaande_rol',
    'nieuwe_rol_gepland',
    'wacht_op_orders',
    'spoed_mogelijk',
  ] as const)('accepteert scenario-waarde "%s"', (scenario) => {
    const s: PerRegelScenario = { ...scenarioFixture, scenario }
    expect(s.scenario).toBe(scenario)
  })
})
