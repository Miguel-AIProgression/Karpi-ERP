// Provider-side contract test: magazijn-module pickbaarheid-seam.
//
// Doel: bewaakt het publieke `fetchPickShipOrders`-contract — caller moet niet
// hoeven weten of `orderregel_pickbaarheid` view bestaat (fallback op
// `order_regels`). Vier scenario's gedekt:
//   1. View aanwezig met N pickbaarheid-regels
//   2. View aanwezig zonder regels (lege array)
//   3. View ontbreekt → fallback op order_regels
//   4. Order zonder regels (header-only)
//
// Geen mocking-framework voor de data — alleen factory-fixtures via een
// dunne fake-Supabase-client. Vi.mock wordt alleen gebruikt om de
// supabase-client-import te vervangen, conform planning-seam.contract.test.ts.

import { describe, it, expect, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Fake Supabase-client met queue-based response per tabel
// ---------------------------------------------------------------------------

type SupabaseResponse = { data: unknown; error: { code?: string; message?: string } | null }

const responses: Record<string, SupabaseResponse[]> = {}

function queueResponse(table: string, response: SupabaseResponse) {
  if (!responses[table]) responses[table] = []
  responses[table].push(response)
}

function buildChain(table: string) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    update: () => chain,
    insert: () => chain,
    then: (
      resolve: (value: SupabaseResponse) => void,
      reject: (reason: unknown) => void
    ) => {
      const next = responses[table]?.shift()
      if (!next) {
        reject(new Error(`Geen response voor tabel "${table}" in test-queue`))
        return
      }
      resolve(next)
    },
  }
  return chain
}

const fakeSupabase = {
  from: (table: string) => buildChain(table),
  rpc: () => Promise.resolve({ data: 0, error: null }),
}

// vi.mock moet voor de import van de query staan. We gebruiken de hoist-truc
// via een module-init function.
import { vi } from 'vitest'
vi.mock('@/lib/supabase/client', () => ({ supabase: fakeSupabase }))

// Pas hierna de query importeren — die pakt nu de fake.
const { fetchPickShipOrders } = await import('../queries/pickbaarheid')
import type { PickShipOrder } from '../lib/types'

// ---------------------------------------------------------------------------
// Factory-fixtures
// ---------------------------------------------------------------------------

interface PickbaarheidRowFixture {
  order_regel_id: number
  order_id: number
  regelnummer: number
  artikelnr: string | null
  is_maatwerk: boolean
  orderaantal: number
  maatwerk_lengte_cm: number | null
  maatwerk_breedte_cm: number | null
  omschrijving: string | null
  maatwerk_kwaliteit_code: string | null
  maatwerk_kleur_code: string | null
  totaal_stuks: number | null
  pickbaar_stuks: number | null
  is_pickbaar: boolean
  bron: 'snijplan' | 'rol' | 'producten_default' | null
  fysieke_locatie: string | null
  wacht_op: 'snijden' | 'confectie' | 'inpak' | 'inkoop' | null
}

function makePickbaarheidRow(
  overrides: Partial<PickbaarheidRowFixture> = {}
): PickbaarheidRowFixture {
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
    bron: 'rol',
    fysieke_locatie: 'A-12',
    wacht_op: null,
    ...overrides,
  }
}

function makeOrderHeader(overrides: Partial<{
  id: number
  order_nr: string
  status: string
  debiteur_nr: number
  afl_naam: string | null
  afl_plaats: string | null
  afleverdatum: string | null
}> = {}) {
  return {
    id: 100,
    order_nr: 'ORD-2026-0001',
    status: 'Nieuw',
    debiteur_nr: 5001,
    afl_naam: 'Klantnaam BV',
    afl_plaats: 'Amsterdam',
    afleverdatum: '2026-05-12',
    ...overrides,
  }
}

function makeDebiteur(debiteur_nr: number, naam: string) {
  return { debiteur_nr, naam }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  for (const k of Object.keys(responses)) delete responses[k]
})

describe('magazijn-pickbaarheid seam — fetchPickShipOrders', () => {
  it('scenario 1: view aanwezig met N regels — orders krijgen pickbaarheid uit view', async () => {
    const headers = [makeOrderHeader({ id: 100, order_nr: 'ORD-2026-0001' })]
    const debiteuren = [makeDebiteur(5001, 'Klantnaam BV')]
    const regels = [
      makePickbaarheidRow({ order_regel_id: 1, order_id: 100, regelnummer: 1, is_pickbaar: true }),
      makePickbaarheidRow({
        order_regel_id: 2,
        order_id: 100,
        regelnummer: 2,
        artikelnr: null,
        is_maatwerk: true,
        orderaantal: 1,
        maatwerk_lengte_cm: 250,
        maatwerk_breedte_cm: 140,
        is_pickbaar: false,
        bron: 'snijplan',
        wacht_op: 'snijden',
      }),
    ]

    queueResponse('orders', { data: headers, error: null })
    queueResponse('debiteuren', { data: debiteuren, error: null })
    queueResponse('orderregel_pickbaarheid', { data: regels, error: null })

    const result = await fetchPickShipOrders({ vandaag: new Date('2026-05-10T12:00:00Z') })

    expect(result).toHaveLength(1)
    const order = result[0] as PickShipOrder
    expect(order.order_nr).toBe('ORD-2026-0001')
    expect(order.klant_naam).toBe('Klantnaam BV')
    expect(order.regels).toHaveLength(2)
    expect(order.regels[0].is_pickbaar).toBe(true)
    expect(order.regels[1].is_maatwerk).toBe(true)
    expect(order.regels[1].wacht_op).toBe('snijden')
  })

  it('scenario 2: view aanwezig zonder regels — order verschijnt header-only met lege regels-array', async () => {
    const headers = [makeOrderHeader({ id: 100 })]
    const debiteuren = [makeDebiteur(5001, 'Klantnaam BV')]

    queueResponse('orders', { data: headers, error: null })
    queueResponse('debiteuren', { data: debiteuren, error: null })
    queueResponse('orderregel_pickbaarheid', { data: [], error: null })

    const result = await fetchPickShipOrders({ vandaag: new Date('2026-05-10T12:00:00Z') })

    expect(result).toHaveLength(1)
    const order = result[0] as PickShipOrder
    expect(order.regels).toEqual([])
    expect(order.aantal_regels).toBe(0)
    expect(order.totaal_m2).toBe(0)
  })

  it('scenario 3: view ontbreekt (PGRST205) — fallback op order_regels', async () => {
    const headers = [makeOrderHeader({ id: 100 })]
    const debiteuren = [makeDebiteur(5001, 'Klantnaam BV')]
    const fallbackRegels = [
      {
        id: 11,
        order_id: 100,
        regelnummer: 1,
        artikelnr: 'P-001',
        is_maatwerk: false,
        orderaantal: 3,
        maatwerk_lengte_cm: null,
        maatwerk_breedte_cm: null,
        omschrijving: 'Fallback regel',
        maatwerk_kwaliteit_code: null,
        maatwerk_kleur_code: null,
      },
    ]

    queueResponse('orders', { data: headers, error: null })
    queueResponse('debiteuren', { data: debiteuren, error: null })
    queueResponse('orderregel_pickbaarheid', {
      data: null,
      error: { code: 'PGRST205', message: "Could not find the table 'public.orderregel_pickbaarheid'" },
    })
    queueResponse('order_regels', { data: fallbackRegels, error: null })

    const result = await fetchPickShipOrders({ vandaag: new Date('2026-05-10T12:00:00Z') })

    expect(result).toHaveLength(1)
    const order = result[0] as PickShipOrder
    expect(order.regels).toHaveLength(1)
    // Fallback-regels: is_pickbaar altijd false, bron + locatie null
    expect(order.regels[0].is_pickbaar).toBe(false)
    expect(order.regels[0].bron).toBeNull()
    expect(order.regels[0].fysieke_locatie).toBeNull()
    expect(order.regels[0].orderaantal).toBe(3)
  })

  it('scenario 4: order zonder regels — header verschijnt zonder regels-rijen', async () => {
    // Dit dekt het edge-geval waarin een order wel openstaat maar (om wat reden
    // ook) géén orderregel_pickbaarheid- of order_regels-rijen heeft. De order
    // moet alsnog in de output staan met regels=[] zodat de magazijn-overview
    // 'm kan tonen ipv stilletjes te verbergen.
    const headers = [makeOrderHeader({ id: 999, order_nr: 'ORD-2026-0099' })]
    const debiteuren = [makeDebiteur(5001, 'Klantnaam BV')]

    queueResponse('orders', { data: headers, error: null })
    queueResponse('debiteuren', { data: debiteuren, error: null })
    queueResponse('orderregel_pickbaarheid', { data: [], error: null })

    const result = await fetchPickShipOrders({ vandaag: new Date('2026-05-10T12:00:00Z') })

    expect(result).toHaveLength(1)
    const order = result[0] as PickShipOrder
    expect(order.order_nr).toBe('ORD-2026-0099')
    expect(order.regels).toEqual([])
    expect(order.aantal_regels).toBe(0)
  })
})
