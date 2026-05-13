import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import { SHIPPING_PRODUCT_ID } from '@/lib/constants/shipping'
import type { RegelDekking } from './dekking-preview'

/**
 * Gedeelde contract-fixtures voor de dekking-preview (ADR-0015, Ingreep 4).
 *
 * Deze fixtures vormen het seam tussen de TS-spiegel (`berekenRegelDekking`)
 * en de SQL-RPC (`simuleer_dekking`). Beide adapters MOETEN voor elke input
 * dezelfde output produceren. De Vitest-suite in `__tests__/dekking-preview.test.ts`
 * draait deze fixtures door `berekenRegelDekking`; een toekomstige BE-test
 * draait dezelfde fixtures door de RPC.
 *
 * Wanneer je een fixture toevoegt of een tak van `berekenRegelDekking`
 * verandert: pas BEIDE adapters aan en verifieer beide testsuites.
 */
export interface RegelDekkingFixture {
  name: string
  input: OrderRegelFormData
  expected: RegelDekking
}

/** Basis-template voor een orderregel — alleen velden die de helper raakt zijn relevant. */
function regel(overrides: Partial<OrderRegelFormData>): OrderRegelFormData {
  return {
    omschrijving: 'Test-regel',
    orderaantal: 0,
    te_leveren: 0,
    korting_pct: 0,
    ...overrides,
  }
}

export const regelDekkingFixtures: RegelDekkingFixture[] = [
  {
    name: 'pure voorraad — vrij dekt te_leveren exact',
    input: regel({ artikelnr: 'KAR-001', te_leveren: 5, vrije_voorraad: 5 }),
    expected: { direct: 5, uitwisselbaar: 0, ioTekort: 0 },
  },
  {
    name: 'pure voorraad — vrij > te_leveren wordt geclipt op te_leveren',
    input: regel({ artikelnr: 'KAR-002', te_leveren: 3, vrije_voorraad: 100 }),
    expected: { direct: 3, uitwisselbaar: 0, ioTekort: 0 },
  },
  {
    name: 'pure IO — geen voorraad, geen uitwisselbaar',
    input: regel({ artikelnr: 'KAR-003', te_leveren: 4, vrije_voorraad: 0 }),
    expected: { direct: 0, uitwisselbaar: 0, ioTekort: 4 },
  },
  {
    name: 'voorraad + IO mix — vrij dekt deel, rest naar IO-tekort',
    input: regel({ artikelnr: 'KAR-004', te_leveren: 10, vrije_voorraad: 4 }),
    expected: { direct: 4, uitwisselbaar: 0, ioTekort: 6 },
  },
  {
    name: 'voorraad + handmatig uitwisselbaar — dekt samen alles',
    input: regel({
      artikelnr: 'KAR-005',
      te_leveren: 10,
      vrije_voorraad: 3,
      uitwisselbaar_keuzes: [{ artikelnr: 'KAR-005-EQ', aantal: 7 }],
    }),
    expected: { direct: 3, uitwisselbaar: 7, ioTekort: 0 },
  },
  {
    name: 'voorraad + uitwisselbaar + IO-tekort — alle drie branches',
    input: regel({
      artikelnr: 'KAR-006',
      te_leveren: 12,
      vrije_voorraad: 2,
      uitwisselbaar_keuzes: [{ artikelnr: 'KAR-006-EQ', aantal: 5 }],
    }),
    expected: { direct: 2, uitwisselbaar: 5, ioTekort: 5 },
  },
  {
    name: 'uitwisselbaar overflow > resterende behoefte wordt geclipt',
    input: regel({
      artikelnr: 'KAR-007',
      te_leveren: 5,
      vrije_voorraad: 2,
      uitwisselbaar_keuzes: [{ artikelnr: 'KAR-007-EQ', aantal: 99 }],
    }),
    expected: { direct: 2, uitwisselbaar: 3, ioTekort: 0 },
  },
  {
    name: 'handmatige uitwisselbaar > te_leveren wordt geclipt (edge case)',
    input: regel({
      artikelnr: 'KAR-008',
      te_leveren: 4,
      vrije_voorraad: 0,
      uitwisselbaar_keuzes: [{ artikelnr: 'KAR-008-EQ', aantal: 99 }],
    }),
    expected: { direct: 0, uitwisselbaar: 4, ioTekort: 0 },
  },
  {
    name: 'meerdere uitwisselbaar-keuzes worden gesommeerd',
    input: regel({
      artikelnr: 'KAR-009',
      te_leveren: 10,
      vrije_voorraad: 1,
      uitwisselbaar_keuzes: [
        { artikelnr: 'KAR-009-EQ-A', aantal: 3 },
        { artikelnr: 'KAR-009-EQ-B', aantal: 2 },
        { artikelnr: 'KAR-009-EQ-C', aantal: 4 },
      ],
    }),
    expected: { direct: 1, uitwisselbaar: 9, ioTekort: 0 },
  },
  {
    name: 'te_leveren = 0 — alle takken nul',
    input: regel({ artikelnr: 'KAR-010', te_leveren: 0, vrije_voorraad: 50 }),
    expected: { direct: 0, uitwisselbaar: 0, ioTekort: 0 },
  },
  {
    name: 'vrije_voorraad ontbreekt (undefined) — defaults op 0',
    input: regel({ artikelnr: 'KAR-011', te_leveren: 5 }),
    expected: { direct: 0, uitwisselbaar: 0, ioTekort: 5 },
  },
  {
    name: 'te_leveren ontbreekt (undefined) — defaults op 0',
    input: regel({ artikelnr: 'KAR-012', vrije_voorraad: 7 }),
    expected: { direct: 0, uitwisselbaar: 0, ioTekort: 0 },
  },
  {
    name: 'maatwerk-regel — altijd nul (geen dekking-preview)',
    input: regel({
      artikelnr: 'KAR-013',
      te_leveren: 1,
      vrije_voorraad: 100,
      is_maatwerk: true,
    }),
    expected: { direct: 0, uitwisselbaar: 0, ioTekort: 0 },
  },
  {
    name: `shipping-product (${SHIPPING_PRODUCT_ID}) — altijd nul`,
    input: regel({
      artikelnr: SHIPPING_PRODUCT_ID,
      is_pseudo: true,  // mig 272 / ADR-0018: admin-pseudo-flag uit producten.is_pseudo
      te_leveren: 1,
      vrije_voorraad: 99,
    }),
    expected: { direct: 0, uitwisselbaar: 0, ioTekort: 0 },
  },
  {
    name: 'lege artikelnr (undefined) — altijd nul (vrije tekst-regel)',
    input: regel({ te_leveren: 5, vrije_voorraad: 5 }),
    expected: { direct: 0, uitwisselbaar: 0, ioTekort: 0 },
  },
  {
    name: 'lege artikelnr (lege string) — altijd nul',
    input: regel({ artikelnr: '', te_leveren: 5, vrije_voorraad: 5 }),
    expected: { direct: 0, uitwisselbaar: 0, ioTekort: 0 },
  },
  {
    name: 'uitwisselbaar_keuze met aantal 0 telt niet mee',
    input: regel({
      artikelnr: 'KAR-017',
      te_leveren: 10,
      vrije_voorraad: 4,
      uitwisselbaar_keuzes: [
        { artikelnr: 'KAR-017-EQ-A', aantal: 0 },
        { artikelnr: 'KAR-017-EQ-B', aantal: 2 },
      ],
    }),
    expected: { direct: 4, uitwisselbaar: 2, ioTekort: 4 },
  },
  {
    name: 'lege uitwisselbaar_keuzes-array — gedraagt zich als geen keuzes',
    input: regel({
      artikelnr: 'KAR-018',
      te_leveren: 6,
      vrije_voorraad: 2,
      uitwisselbaar_keuzes: [],
    }),
    expected: { direct: 2, uitwisselbaar: 0, ioTekort: 4 },
  },
  {
    name: 'maatwerk + shipping (impossible maar veilig) — nul',
    input: regel({
      artikelnr: SHIPPING_PRODUCT_ID,
      te_leveren: 1,
      vrije_voorraad: 0,
      is_maatwerk: true,
    }),
    expected: { direct: 0, uitwisselbaar: 0, ioTekort: 0 },
  },
  {
    name: 'voorraad dekt exact alleen na uitwisselbaar — uitwisselbaar krijgt prio na voorraad',
    input: regel({
      artikelnr: 'KAR-020',
      te_leveren: 8,
      vrije_voorraad: 8,
      uitwisselbaar_keuzes: [{ artikelnr: 'KAR-020-EQ', aantal: 4 }],
    }),
    expected: { direct: 8, uitwisselbaar: 0, ioTekort: 0 },
  },
]
