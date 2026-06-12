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
    // maybeSingle() retourneert hetzelfde thenable (single-rij-semantiek) —
    // de response uit de queue wordt in de then()-handler geserveerd.
    maybeSingle: () => chain,
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
    afhalen: false,
    lever_type: 'week' as const,
    ...overrides,
  }
}

function makeDebiteur(
  debiteur_nr: number,
  naam: string,
  deelleveringen_toegestaan = false,
) {
  return { debiteur_nr, naam, deelleveringen_toegestaan }
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
    // deelleveringen_toegestaan=true zodat de gemengde order (pickbaar + 'Wacht
    // op snijden') zichtbaar blijft. Het wacht-op-snijden-filter heeft een
    // dedicated scenario verderop.
    const debiteuren = [makeDebiteur(5001, 'Klantnaam BV', true)]
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

    // app_config 'werkagenda' — parallel opgehaald door fetchWerkagendaConfig (mig 384).
    // Lege DB-rij = standaard werktijden (maandag–vrijdag, geen feestdagen).
    queueResponse('app_config', { data: null, error: null })
    queueResponse('orders', { data: headers, error: null })
    queueResponse('debiteuren', { data: debiteuren, error: null })
    queueResponse('orderregel_pickbaarheid', { data: regels, error: null })
    queueResponse('producten', {
      data: [{ artikelnr: 'P-001', omschrijving: 'KARPI SANDRO 200x140' }],
      error: null,
    })
    // Gewicht-aggregaat (nieuwe Pick & Ship-kolom): som van
    // gewicht_kg × orderaantal per order, gevoed uit order_regels.
    queueResponse('order_regels', {
      data: [
        { order_id: 100, gewicht_kg: 4.5, orderaantal: 2, artikelnr: 'P-001' },
        { order_id: 100, gewicht_kg: 7.0, orderaantal: 1, artikelnr: null },
      ],
      error: null,
    })
    // Mig 217: actieve Pickrondes per order. Lege array = geen lopende pickronde.
    queueResponse('zendingen', { data: [], error: null })

    const result = await fetchPickShipOrders({ vandaag: new Date('2026-05-10T12:00:00Z') })

    expect(result).toHaveLength(1)
    const order = result[0] as PickShipOrder
    expect(order.order_nr).toBe('ORD-2026-0001')
    expect(order.klant_naam).toBe('Klantnaam BV')
    expect(order.regels).toHaveLength(2)
    expect(order.regels[0].is_pickbaar).toBe(true)
    // Pick & Ship toont Karpi-naam uit producten.omschrijving, niet de
    // klanteigen-omschrijving op de orderregel (mig 200).
    expect(order.regels[0].product).toBe('KARPI SANDRO 200x140')
    expect(order.regels[1].is_maatwerk).toBe(true)
    expect(order.regels[1].wacht_op).toBe('snijden')
    // Totaal gewicht = 4.5×2 + 7.0×1 = 16.0 kg
    expect(order.totaal_gewicht_kg).toBe(16)
  })

  it('scenario 2: view aanwezig zonder regels — header-only orders worden uitgefilterd', async () => {
    // Een order zonder regels valt niet te picken; magazijn ziet 'm dus niet
    // op Pick & Ship. Dat hoort bij hetzelfde pickbaarheids-filter dat orders
    // met enkel onpickbare regels (wacht op snijden/inkoop/...) verbergt.
    const headers = [makeOrderHeader({ id: 100 })]
    const debiteuren = [makeDebiteur(5001, 'Klantnaam BV')]

    queueResponse('app_config', { data: null, error: null })
    queueResponse('orders', { data: headers, error: null })
    queueResponse('debiteuren', { data: debiteuren, error: null })
    queueResponse('orderregel_pickbaarheid', { data: [], error: null })
    queueResponse('order_regels', { data: [], error: null })
    queueResponse('zendingen', { data: [], error: null })

    const result = await fetchPickShipOrders({ vandaag: new Date('2026-05-10T12:00:00Z') })

    expect(result).toHaveLength(0)
  })

  it('scenario 3: view ontbreekt (PGRST205) — fallback op order_regels, geen pickbaarheid bekend', async () => {
    // Wanneer de pickbaarheid-view ontbreekt valt de query terug op
    // `order_regels` zonder pickbaarheids-info; alle regels staan default op
    // `is_pickbaar=false`. Het pickbaarheidsfilter laat de order daardoor
    // weg — veiliger dan iets tonen waarvan de staat onbekend is. Dit is een
    // dev/legacy-pad, niet de productie-flow.
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

    queueResponse('app_config', { data: null, error: null })
    queueResponse('orders', { data: headers, error: null })
    queueResponse('debiteuren', { data: debiteuren, error: null })
    queueResponse('orderregel_pickbaarheid', {
      data: null,
      error: { code: 'PGRST205', message: "Could not find the table 'public.orderregel_pickbaarheid'" },
    })
    queueResponse('order_regels', { data: fallbackRegels, error: null })
    queueResponse('producten', { data: [], error: null })
    queueResponse('zendingen', { data: [], error: null })
    queueResponse('order_regels', { data: [], error: null })

    const result = await fetchPickShipOrders({ vandaag: new Date('2026-05-10T12:00:00Z') })

    // Fallback-regels staan op is_pickbaar=false en de klant zonder
    // deelleveringen ziet de order niet. Dit is het correcte gedrag voor
    // een productie-omgeving zonder pickbaarheid-view (ongebruikelijk maar
    // veilig: liever niets tonen dan onbekende staat).
    expect(result).toHaveLength(0)
  })

  it('scenario 5: order met onpickbare regel + klant zonder deelleveringen → uitgefilterd', async () => {
    // Geldt voor elke onpickbaarheids-reden ('snijden', 'inkoop', 'confectie',
    // 'inpak'). Klant zonder deelleveringen ziet alleen orders waarbij álles
    // pickbaar is; gemixte orders blijven verborgen tot het laatste regel
    // klaar is. Hier: 'wacht op snijden' als representatieve reden.
    const headers = [makeOrderHeader({ id: 100, order_nr: 'ORD-2026-0040' })]
    const debiteuren = [makeDebiteur(5001, 'Klantnaam BV', false)]
    const regels = [
      makePickbaarheidRow({ order_regel_id: 1, order_id: 100, regelnummer: 1, is_pickbaar: true }),
      makePickbaarheidRow({
        order_regel_id: 2,
        order_id: 100,
        regelnummer: 2,
        artikelnr: null,
        is_maatwerk: true,
        orderaantal: 1,
        is_pickbaar: false,
        bron: 'snijplan',
        wacht_op: 'snijden',
      }),
    ]

    queueResponse('app_config', { data: null, error: null })
    queueResponse('orders', { data: headers, error: null })
    queueResponse('debiteuren', { data: debiteuren, error: null })
    queueResponse('orderregel_pickbaarheid', { data: regels, error: null })
    queueResponse('producten', { data: [], error: null })
    queueResponse('order_regels', { data: [], error: null })
    queueResponse('zendingen', { data: [], error: null })

    const result = await fetchPickShipOrders({ vandaag: new Date('2026-05-10T12:00:00Z') })

    expect(result).toHaveLength(0)
  })

  it('scenario 6: alle regels wacht_op=snijden + klant met deelleveringen → uitgefilterd', async () => {
    // Zelfs met deelleveringen toegestaan moet er minstens één pickbare regel
    // zijn — anders valt er niks te shippen.
    const headers = [makeOrderHeader({ id: 100, order_nr: 'ORD-2026-0040' })]
    const debiteuren = [makeDebiteur(5001, 'Klantnaam BV', true)]
    const regels = [
      makePickbaarheidRow({
        order_regel_id: 1,
        order_id: 100,
        regelnummer: 1,
        is_pickbaar: false,
        bron: 'snijplan',
        wacht_op: 'snijden',
      }),
    ]

    queueResponse('app_config', { data: null, error: null })
    queueResponse('orders', { data: headers, error: null })
    queueResponse('debiteuren', { data: debiteuren, error: null })
    queueResponse('orderregel_pickbaarheid', { data: regels, error: null })
    queueResponse('producten', { data: [], error: null })
    queueResponse('order_regels', { data: [], error: null })
    queueResponse('zendingen', { data: [], error: null })

    const result = await fetchPickShipOrders({ vandaag: new Date('2026-05-10T12:00:00Z') })

    expect(result).toHaveLength(0)
  })

  it('scenario 4: order zonder regels — uitgefilterd (niets te picken)', async () => {
    // Webshop-orders komen soms binnen zonder gematchte productregels (zie
    // ORD-2026-2039 in de Floorpassion-import). Magazijn kan er niets mee;
    // het pickbaarheidsfilter haalt ze daarom uit Pick & Ship.
    const headers = [makeOrderHeader({ id: 999, order_nr: 'ORD-2026-0099' })]
    const debiteuren = [makeDebiteur(5001, 'Klantnaam BV')]

    queueResponse('app_config', { data: null, error: null })
    queueResponse('orders', { data: headers, error: null })
    queueResponse('debiteuren', { data: debiteuren, error: null })
    queueResponse('orderregel_pickbaarheid', { data: [], error: null })
    queueResponse('order_regels', { data: [], error: null })
    queueResponse('zendingen', { data: [], error: null })

    const result = await fetchPickShipOrders({ vandaag: new Date('2026-05-10T12:00:00Z') })

    expect(result).toHaveLength(0)
  })

  it('scenario 7: order met wacht_op=inkoop + klant zonder deelleveringen → uitgefilterd', async () => {
    // Zelfde regel als scenario 5 maar voor inkoop-tekort. Bevestigt dat het
    // filter generiek werkt, niet alleen voor 'snijden'.
    const headers = [makeOrderHeader({ id: 100, order_nr: 'ORD-2026-2033' })]
    const debiteuren = [makeDebiteur(5001, 'WHOON OISTERWIJK', false)]
    const regels = [
      makePickbaarheidRow({
        order_regel_id: 1,
        order_id: 100,
        regelnummer: 1,
        is_pickbaar: false,
        bron: null,
        wacht_op: 'inkoop',
      }),
    ]

    queueResponse('app_config', { data: null, error: null })
    queueResponse('orders', { data: headers, error: null })
    queueResponse('debiteuren', { data: debiteuren, error: null })
    queueResponse('orderregel_pickbaarheid', { data: regels, error: null })
    queueResponse('producten', { data: [], error: null })
    queueResponse('order_regels', { data: [], error: null })
    queueResponse('zendingen', { data: [], error: null })

    const result = await fetchPickShipOrders({ vandaag: new Date('2026-05-10T12:00:00Z') })

    expect(result).toHaveLength(0)
  })
})
