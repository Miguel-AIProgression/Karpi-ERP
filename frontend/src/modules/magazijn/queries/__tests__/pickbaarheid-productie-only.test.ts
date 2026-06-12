// R1-guard-test: productie-only orders (orders.alleen_productie=true, uit Basta)
// mogen NOOIT in Pick & Ship verschijnen — die worden in Basta afgehandeld.
//
// Mock via de gedeelde helper `__tests__/helpers/fake-supabase` (queue-based
// fake-Supabase per tabel), die de R1-guard daadwerkelijk kan verifiëren:
//   1. De `orders`-chain registreert de toegepaste `.eq(...)`-filters zodat we
//      kunnen asserten dàt `.eq('alleen_productie', false)` in de querychain zit
//      (TDD-anker: zonder de guard uit deeltaak 1 ontbreekt deze filter).
//   2. De `orders`-chain past die `.eq`-filters ook echt toe op de fixture-data,
//      zodat een order met `alleen_productie=true` er — net als bij PostgREST —
//      uitgefilterd wordt en `fetchPickShipOrders` 'm niet teruggeeft.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  fakeSupabase,
  queueResponse,
  resetQueues,
  appliedEqFilters,
} from '../../__tests__/helpers/fake-supabase'

vi.mock('@/lib/supabase/client', () => ({ supabase: fakeSupabase }))

const { fetchPickShipOrders } = await import('../pickbaarheid')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeOrderHeader(
  overrides: Partial<{
    id: number
    order_nr: string
    status: string
    debiteur_nr: number
    afl_naam: string | null
    afl_plaats: string | null
    afleverdatum: string | null
    alleen_productie: boolean
  }> = {}
) {
  return {
    id: 100,
    order_nr: 'ORD-2026-0001',
    status: 'Nieuw',
    debiteur_nr: 5001,
    afl_naam: 'Klantnaam BV',
    afl_plaats: 'Amsterdam',
    afleverdatum: '2026-05-12',
    afhalen: false,
    lever_type: 'week' as const,
    alleen_productie: false,   // R1-guard-veld (mig 345); helper filtert hierop
    ...overrides,
  }
}

function makePickbaarheidRow(
  overrides: Partial<{
    order_regel_id: number
    order_id: number
    regelnummer: number
    artikelnr: string | null
    is_pickbaar: boolean
  }> = {}
) {
  return {
    order_regel_id: 1,
    order_id: 100,
    regelnummer: 1,
    artikelnr: 'P-001',
    is_maatwerk: false,
    orderaantal: 2,
    maatwerk_lengte_cm: null,
    maatwerk_breedte_cm: null,
    omschrijving: 'Standaard tapijt 200x140',
    maatwerk_kwaliteit_code: null,
    maatwerk_kleur_code: null,
    totaal_stuks: 2,
    pickbaar_stuks: 2,
    is_pickbaar: true,
    bron: 'rol' as const,
    fysieke_locatie: 'A-12',
    wacht_op: null,
    ...overrides,
  }
}

function makeDebiteur(debiteur_nr: number, naam: string, deelleveringen_toegestaan = false) {
  return { debiteur_nr, naam, deelleveringen_toegestaan }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => resetQueues())

describe('Pick & Ship R1-guard — productie-only orders worden uitgefilterd', () => {
  it('past .eq(alleen_productie, false) toe op de orders-querychain', async () => {
    queueResponse('orders', { data: [], error: null })

    await fetchPickShipOrders({ vandaag: new Date('2026-05-10T12:00:00Z') })

    // De R1-guard moet als expliciete filter in de orders-query zitten.
    expect(appliedEqFilters['orders']).toContainEqual(['alleen_productie', false])
  })

  it('geeft een order met alleen_productie=true NIET terug', async () => {
    const headers = [
      makeOrderHeader({ id: 100, order_nr: 'ORD-2026-0001', alleen_productie: false }),
      makeOrderHeader({
        id: 200,
        order_nr: 'OUD-12345',
        debiteur_nr: 900000,
        alleen_productie: true,
      }),
    ]
    const debiteuren = [
      makeDebiteur(5001, 'Klantnaam BV'),
      makeDebiteur(900000, 'OUD SYSTEEM (PRODUCTIE)'),
    ]
    // BEIDE orders krijgen pickbare regels — zónder de R1-guard zou de
    // productie-only order (200) dus wél in het resultaat belanden. Met de
    // guard wordt 'ie SQL-zijde al weggefilterd (en komt 'ie nooit bij de
    // regel-fetch). Zo is deze assertie strikt afhankelijk van de guard.
    const regels = [
      makePickbaarheidRow({ order_regel_id: 1, order_id: 100, is_pickbaar: true }),
      makePickbaarheidRow({
        order_regel_id: 2,
        order_id: 200,
        regelnummer: 1,
        is_pickbaar: true,
      }),
    ]

    queueResponse('orders', { data: headers, error: null })
    queueResponse('debiteuren', { data: debiteuren, error: null })
    queueResponse('orderregel_pickbaarheid', { data: regels, error: null })
    queueResponse('producten', {
      data: [{ artikelnr: 'P-001', omschrijving: 'KARPI SANDRO 200x140' }],
      error: null,
    })
    queueResponse('order_regels', {
      data: [
        { order_id: 100, gewicht_kg: 4.5, orderaantal: 2, artikelnr: 'P-001' },
        { order_id: 200, gewicht_kg: 4.5, orderaantal: 2, artikelnr: 'P-001' },
      ],
      error: null,
    })
    // Mig 222: actieve pickrondes via zending_orders M2M. Lege array = geen lopende ronde.
    queueResponse('zending_orders', { data: [], error: null })
    // Mig 383: order-niveau-predicaat uit view order_pickbaarheid. Alleen order
    // 100 — order 200 is door de R1-guard al SQL-zijde weggefilterd.
    queueResponse('order_pickbaarheid', {
      data: [{
        order_id: 100,
        totaal_regels: 1,
        pickbare_regels: 1,
        alle_regels_pickbaar: true,
        heeft_pickbare_regel: true,
        deelleveringen_toegestaan: false,
        pick_ship_zichtbaar: true,
      }],
      error: null,
    })

    const result = await fetchPickShipOrders({ vandaag: new Date('2026-05-10T12:00:00Z') })

    // De productie-only order (200/OUD-12345) mag NIET in het resultaat staan.
    expect(result.map((o) => o.order_nr)).not.toContain('OUD-12345')
    // De gewone order blijft gewoon zichtbaar.
    expect(result.map((o) => o.order_nr)).toContain('ORD-2026-0001')
    expect(result).toHaveLength(1)
  })
})
