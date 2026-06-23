// Karakteriseringstest voor usePickbaarheid (ADR-0037). Legt het knop-gedrag
// vast: na de refactor naar `bepaalStartbaarheid` moeten `pickbareOrders` en de
// per-reden sets/counts exact hetzelfde zijn als vóór de consolidatie. Tevens de
// bewuste gedragswijziging: een order die niet-pickbaar én zonder vervoerder is,
// telt NIET (meer) als geen_vervoerder (isPickbaar-guard, single source).
//
// De batch-resolver wordt gemockt zodat we de vervoerder-bron per order sturen
// zonder DB; de hook draait verder echt (React Query + de pure predikaat-laag).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

// Mock de hele queries-module met alléén de batch-resolver — géén importOriginal,
// anders laadt de echte module de supabase-client (vereist .env, ontbreekt in een
// worktree). De context-consumer gebruikt runtime alleen deze functie.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('../queries/orderregel-vervoerder', () => ({
  fetchEffectieveVervoerderVoorOrders: fetchMock,
}))

const { usePickbaarheid } = await import('./use-pickbaarheid')
import type { OrderregelVervoerder } from '../queries/orderregel-vervoerder'
import type { PickShipOrder } from '@/modules/magazijn'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function order(over: Partial<PickShipOrder> & { order_id: number }): PickShipOrder {
  return {
    order_nr: `ORD-2026-${String(over.order_id).padStart(4, '0')}`,
    status: 'Nieuw',
    klant_naam: 'Klant BV',
    debiteur_nr: 5001,
    afl_naam: 'Klant BV',
    afl_adres: 'Straat 1',
    afl_postcode: '1000 AA',
    afl_plaats: 'Amsterdam',
    afl_land: 'NL',
    afleverdatum: '2026-06-25',
    afhalen: false,
    lever_type: 'week',
    bucket: 'wk_1',
    verzend_week_sleutel: '2026-W26',
    verzend_week_label: 'Verzendweek 26',
    verzend_week_kort: 'Wk 26',
    regels: [],
    totaal_m2: 1,
    totaal_gewicht_kg: 1,
    aantal_regels: 1,
    alle_regels_pickbaar: true,
    heeft_gepland_zending: false,
    afl_adres_incompleet_sinds: null,
    prijs_ontbreekt_sinds: null,
    actieve_pickronde: null,
    ...over,
  }
}

function regel(bron: OrderregelVervoerder['bron']): OrderregelVervoerder {
  return {
    orderregel_id: 1,
    override_code: null,
    evaluator_code: null,
    evaluator_service: null,
    effectief_code: bron === 'geen' ? null : 'hst_api',
    effectief_service: null,
    bron,
    is_locked: false,
    uitleg: null,
  }
}

/** Mock de batch-resolver met een vaste order_id → regels-map. */
function mockResolutie(map: Record<number, OrderregelVervoerder[]>) {
  fetchMock.mockResolvedValue(new Map(Object.entries(map).map(([id, r]) => [Number(id), r])))
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return createElement(QueryClientProvider, { client: qc }, children)
}

async function run(orders: PickShipOrder[]) {
  const { result } = renderHook(() => usePickbaarheid(orders), { wrapper })
  await waitFor(() => expect(result.current.vervoerderResolutieLaadt).toBe(false))
  return result.current
}

beforeEach(() => fetchMock.mockReset())

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePickbaarheid — knop-contract (ADR-0037)', () => {
  it('classificeert de volledige status-matrix in de juiste sets', async () => {
    const orders = [
      order({ order_id: 1 }), // startbaar (carrier ok)
      order({ order_id: 2, afhalen: true }), // startbaar (afhalen, geen carrier nodig)
      order({ order_id: 3, alle_regels_pickbaar: false }), // niet_pickbaar
      order({ order_id: 4, afl_adres_incompleet_sinds: '2026-06-18T10:00:00Z' }), // afl_adres
      order({ order_id: 5, prijs_ontbreekt_sinds: '2026-06-18T10:00:00Z' }), // prijs
      order({ order_id: 6 }), // geen_vervoerder (carrier bron='geen')
      order({ order_id: 7, actieve_pickronde: { zending_id: 9, zending_nr: 'ZEND-2026-0009', picker_id: null, picker_naam: null } }), // in_pickronde
    ]
    mockResolutie({
      1: [regel('regel')],
      3: [regel('regel')],
      4: [regel('regel')],
      5: [regel('regel')],
      6: [regel('geen')],
      7: [regel('regel')],
    })

    const r = await run(orders)

    expect(r.pickbareOrders.map((o) => o.order_id).sort()).toEqual([1, 2])
    expect([...r.geenVervoerderIds]).toEqual([6])
    expect([...r.aflAdresIds]).toEqual([4])
    expect([...r.prijsIds]).toEqual([5])
    expect(r.aantalGeenVervoerder).toBe(1)
    expect(r.aantalAflAdres).toBe(1)
    expect(r.aantalPrijs).toBe(1)
    expect(r.aantalGeblokkeerd).toBe(3)
  })

  it('unificatie-fix: niet-pickbaar ÉN geen-vervoerder telt als niet_pickbaar, niet als geen_vervoerder', async () => {
    const orders = [
      order({ order_id: 8, alle_regels_pickbaar: false }), // niet-pickbaar én...
    ]
    mockResolutie({ 8: [regel('geen')] }) // ...geen vervoerder

    const r = await run(orders)

    // De order is niet pickbaar én telt niet als geblokkeerd-door-vervoerder
    // (geen_vervoerder is de laagste prio → isPickbaar-guard).
    expect(r.pickbareOrders).toHaveLength(0)
    expect(r.geenVervoerderIds.has(8)).toBe(false)
    expect(r.aantalGeblokkeerd).toBe(0)
  })

  it('adres- én vervoerder-blokkade samen: telt als afl_adres (adres heeft voorrang)', async () => {
    const orders = [
      order({ order_id: 9, afl_adres_incompleet_sinds: '2026-06-18T10:00:00Z' }),
    ]
    mockResolutie({ 9: [regel('geen')] })

    const r = await run(orders)

    expect(r.aflAdresIds.has(9)).toBe(true)
    expect(r.geenVervoerderIds.has(9)).toBe(false)
    expect(r.aantalGeblokkeerd).toBe(1)
  })
})
