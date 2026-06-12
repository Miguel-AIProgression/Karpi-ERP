// Provider-side contract test: magazijn-module pickbaarheid-seam.
//
// Doel: bewaakt het publieke `fetchPickShipOrders`-contract — de view
// `orderregel_pickbaarheid` is de enige bron; ontbreekt ze → hard falen
// (geen stille fallback). Acht scenario's gedekt:
//   1. View aanwezig met N pickbaarheid-regels (gewicht via view-kolom)
//   2. View aanwezig zonder regels (lege array) → order uitgefilterd
//   3. View-query faalt (PGRST205) → fout propageert, geen stille fallback
//   4. Order zonder regels (header-only) → uitgefilterd
//   5. Onpickbare regel + klant zonder deelleveringen → uitgefilterd
//   6. Alle regels wacht_op=snijden + deelleveringen=true → uitgefilterd
//   7. Wacht_op=inkoop + klant zonder deelleveringen → uitgefilterd
//   8. Dag-order (lever_type=datum): buiten horizon onzichtbaar, erbinnen zichtbaar
//
// Mig 385 is een deploy-voorwaarde: de view vervangt zowel de oude
// PGRST205-fallback op order_regels als de aparte gewicht-query.
//
// Geen mocking-framework voor de data — alleen factory-fixtures via een
// dunne fake-Supabase-client. Vi.mock wordt alleen gebruikt om de
// supabase-client-import te vervangen, conform planning-seam.contract.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  fakeSupabase,
  queueResponse,
  resetQueues,
} from './helpers/fake-supabase'

// vi.mock moet voor de import van de query staan. We gebruiken de hoist-truc
// via een module-init function.
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
  gewicht_kg: number | null
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
    gewicht_kg: 4.5,
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
  lever_type: 'week' | 'datum'
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
    alleen_productie: false,   // R1-guard-veld (mig 345); helper filtert hierop
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

function makeOrderPickbaarheidRow(overrides: Partial<{
  order_id: number
  totaal_regels: number
  pickbare_regels: number
  alle_regels_pickbaar: boolean
  heeft_pickbare_regel: boolean
  deelleveringen_toegestaan: boolean
  pick_ship_zichtbaar: boolean
}> = {}) {
  return {
    order_id: 100,
    totaal_regels: 1,
    pickbare_regels: 1,
    alle_regels_pickbaar: true,
    heeft_pickbare_regel: true,
    deelleveringen_toegestaan: false,
    pick_ship_zichtbaar: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => resetQueues())

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
        gewicht_kg: 7.0,
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
    // Mig 242: actieve Pickrondes per order via zending_orders M2M. Leeg = geen lopende pickronde.
    queueResponse('zending_orders', { data: [], error: null })
    // Mig 385: order-niveau-predicaat uit view order_pickbaarheid. Gemengde order:
    // 1 pickbaar + 1 wacht-op-snijden, deelleveringen=true → zichtbaar via deellevering.
    queueResponse('order_pickbaarheid', {
      data: [makeOrderPickbaarheidRow({
        totaal_regels: 2, pickbare_regels: 1, alle_regels_pickbaar: false,
        heeft_pickbare_regel: true, deelleveringen_toegestaan: true, pick_ship_zichtbaar: true,
      })],
      error: null,
    })

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
    // Mig 385: order-niveau-predicaat vanuit view — niet client-side herleid.
    expect(order.alle_regels_pickbaar).toBe(false)
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
    queueResponse('zending_orders', { data: [], error: null })
    // Mig 385: geen regels → geen rij in order_pickbaarheid → order onzichtbaar.
    queueResponse('order_pickbaarheid', { data: [], error: null })

    const result = await fetchPickShipOrders({ vandaag: new Date('2026-05-10T12:00:00Z') })

    expect(result).toHaveLength(0)
  })

  it('scenario 3: view-query faalt → fout propageert (geen stille fallback meer)', async () => {
    // De PGRST205-fallback op order_regels is verwijderd (mig 385 is een
    // deploy-voorwaarde). Een ontbrekende view moet hard en zichtbaar falen,
    // niet stil een lege Pick & Ship opleveren.
    queueResponse('app_config', { data: null, error: null })
    queueResponse('orders', { data: [makeOrderHeader({ id: 100 })], error: null })
    queueResponse('debiteuren', { data: [makeDebiteur(5001, 'Klantnaam BV')], error: null })
    queueResponse('orderregel_pickbaarheid', {
      data: null,
      error: { code: 'PGRST205', message: "Could not find the table 'public.orderregel_pickbaarheid'" },
    })
    await expect(
      fetchPickShipOrders({ vandaag: new Date('2026-05-10T12:00:00Z') })
    ).rejects.toMatchObject({ code: 'PGRST205' })
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
    queueResponse('zending_orders', { data: [], error: null })
    // Mig 385: gemengd zonder deelleveringen → pick_ship_zichtbaar=false.
    queueResponse('order_pickbaarheid', {
      data: [makeOrderPickbaarheidRow({
        totaal_regels: 2, pickbare_regels: 1, alle_regels_pickbaar: false,
        heeft_pickbare_regel: true, deelleveringen_toegestaan: false, pick_ship_zichtbaar: false,
      })],
      error: null,
    })

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
    queueResponse('zending_orders', { data: [], error: null })
    // Mig 385: alle regels wachten + deelleveringen=true → maar geen pickbare
    // regel aanwezig → pick_ship_zichtbaar=false.
    queueResponse('order_pickbaarheid', {
      data: [makeOrderPickbaarheidRow({
        totaal_regels: 1, pickbare_regels: 0, alle_regels_pickbaar: false,
        heeft_pickbare_regel: false, deelleveringen_toegestaan: true, pick_ship_zichtbaar: false,
      })],
      error: null,
    })

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
    queueResponse('zending_orders', { data: [], error: null })
    // Mig 385: geen regels → geen rij in order_pickbaarheid → order onzichtbaar.
    queueResponse('order_pickbaarheid', { data: [], error: null })

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
    queueResponse('zending_orders', { data: [], error: null })
    // Mig 385: wacht op inkoop, geen deelleveringen → pick_ship_zichtbaar=false.
    queueResponse('order_pickbaarheid', {
      data: [makeOrderPickbaarheidRow({
        totaal_regels: 1, pickbare_regels: 0, alle_regels_pickbaar: false,
        heeft_pickbare_regel: false, deelleveringen_toegestaan: false, pick_ship_zichtbaar: false,
      })],
      error: null,
    })

    const result = await fetchPickShipOrders({ vandaag: new Date('2026-05-10T12:00:00Z') })

    expect(result).toHaveLength(0)
  })

  it('scenario 8: dag-order (lever_type=datum) blijft buiten horizon, verschijnt erbinnen', async () => {
    // ADR 0014 / mig 244: de dag-order-horizon is de enige client-side
    // filterlogica die na mig 385 overblijft (hangt af van `vandaag`).
    // Een dag-order met afleverdatum di 2026-05-12 verschijnt pas vanaf
    // werkdagMinN(2026-05-12, 1) = ma 2026-05-11.
    const maakQueues = () => {
      // app_config 'werkagenda' — parallel opgehaald door fetchWerkagendaConfig
      // (mig 384). Lege rij = standaard werktijden (ma-vr, geen feestdagen).
      queueResponse('app_config', { data: null, error: null })
      queueResponse('orders', {
        data: [makeOrderHeader({ id: 100, lever_type: 'datum' as const, afleverdatum: '2026-05-12' })],
        error: null,
      })
      queueResponse('debiteuren', { data: [makeDebiteur(5001, 'Klantnaam BV')], error: null })
      queueResponse('orderregel_pickbaarheid', {
        data: [makePickbaarheidRow({ order_regel_id: 1, order_id: 100, is_pickbaar: true })],
        error: null,
      })
      queueResponse('producten', { data: [], error: null })
      queueResponse('order_pickbaarheid', { data: [makeOrderPickbaarheidRow()], error: null })
      queueResponse('zending_orders', { data: [], error: null })
    }

    // Vrijdag 8 mei = vóór de horizon (ma 11 mei) → onzichtbaar.
    maakQueues()
    const teVroeg = await fetchPickShipOrders({ vandaag: new Date('2026-05-08T12:00:00Z') })
    expect(teVroeg).toHaveLength(0)

    // Maandag 11 mei = op de horizon → zichtbaar.
    resetQueues()
    maakQueues()
    const opHorizon = await fetchPickShipOrders({ vandaag: new Date('2026-05-11T12:00:00Z') })
    expect(opHorizon).toHaveLength(1)
  })
})
