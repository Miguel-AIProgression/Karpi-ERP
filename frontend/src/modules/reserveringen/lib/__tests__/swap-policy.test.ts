// Contract-fixtures voor de deadline-bewuste claim-swap (ADR-0027 / mig 297-298).
//
// =============================================================================
// LET OP: deze fixtures testen SQL-only gedrag (PL/pgSQL in
// `herallocateer_orderregel` + `sync_order_afleverdatum_met_claims`).
// Er is GEEN TypeScript-spiegel voor de swap-allocator — de hele beslislogica
// leeft in mig 297. Vitest kan daarom de scenarios niet zelf uitvoeren tegen
// een echte database.
//
// Het bestand publiceert wel het CONTRACT als datastructuren (input-state +
// expected-end-state) zodat:
//   1. de developer per fixture exact ziet wat de SQL behoort te doen,
//   2. een vervolg-PR een integratie-test-runner (bv. pgTAP, dbt-test, of een
//      Vitest-runner die een lokale Supabase opspint) ze daadwerkelijk kan
//      executeren tegen een testdatabase.
//
// Alle `it.todo`-calls hieronder zijn dus geen vergeten tests — het zijn
// markers die zeggen "dit is gespecificeerd, de runner ontbreekt nog".
//
// Vervolg-PR: voeg een `swap-policy.integration.test.ts` toe die
// `vitest --pool=forks` gebruikt met een geseede lokale Supabase + de fixtures
// hieronder als drijvende data.
// =============================================================================

import { describe, it, expect } from 'vitest'

/**
 * Minimale DB-fixture-shape om een swap-scenario te beschrijven.
 * Velden volgen de echte schema's van orders / order_regels / order_reserveringen /
 * inkooporder_regels — niet uitputtend, alleen het deel dat de swap raakt.
 */
interface OrderFix {
  id: number
  status: 'Nieuw' | 'Wacht op voorraad' | 'Wacht op inkoop' | 'Verzonden' | 'Geannuleerd'
  afleverdatum: string             // ISO YYYY-MM-DD
  standaard_afleverdatum_berekend: string | null
}

interface OrderRegelFix {
  id: number
  order_id: number
  artikelnr: string
  te_leveren: number
  is_maatwerk?: boolean
}

interface IoRegelFix {
  id: number
  artikelnr: string
  eenheid: 'm' | 'stuks'
  te_leveren_m: number               // capaciteit
  verwacht_datum: string             // ISO
  io_status: 'Besteld' | 'Deels ontvangen' | 'Geannuleerd'
}

interface ClaimFix {
  id: number
  order_regel_id: number
  bron: 'voorraad' | 'inkooporder_regel'
  inkooporder_regel_id: number | null
  aantal: number
  fysiek_artikelnr: string
  is_handmatig?: boolean
  status: 'actief' | 'released'
}

interface VoorraadFix {
  artikelnr: string
  voorraad: number
}

interface AppConfigFix {
  inkoop_buffer_weken_vast: number   // weken → buffer-dagen = ×7
}

interface SwapFixture {
  name: string
  given: {
    appConfig: AppConfigFix
    voorraad: VoorraadFix[]
    orders: OrderFix[]
    orderRegels: OrderRegelFix[]
    ioRegels: IoRegelFix[]
    initialClaims: ClaimFix[]
  }
  /** RPC-input: orderregel waarvoor `herallocateer_orderregel` aangeroepen wordt. */
  triggerOnOrderRegelId: number
  expected: {
    /** Eind-claim-staat per orderregel (`actief`-only). */
    finalActiveClaims: Array<{
      order_regel_id: number
      bron: 'voorraad' | 'inkooporder_regel'
      io_regel_id?: number
      aantal: number
      fysiek_artikelnr: string
    }>
    /** Verwachte order_events-insertions (post-RPC). */
    expectedEvents: Array<{
      order_id: number
      event_type:
        | 'claim_geswapt_weg'
        | 'claim_geswapt_naar'
        | 'deadline_conflict_na_swap'
      metadata_match: Record<string, unknown>
    }>
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
// Notatie: A = bestaande order met latere deadline (swap-bron).
//          B = nieuwe/urgent order die voorraad nodig heeft (swap-target).
// Buffer-conventie in alle fixtures: inkoop_buffer_weken_vast=1 → 7 dagen.
// ---------------------------------------------------------------------------

export const swapPolicyFixtures: SwapFixture[] = [
  {
    name: 'basis: B urgent + A late + IO past binnen A.afleverdatum → swap',
    given: {
      appConfig: { inkoop_buffer_weken_vast: 1 },
      voorraad: [{ artikelnr: 'CISCO', voorraad: 1 }],
      orders: [
        { // A — bewust later dan standaard
          id: 100,
          status: 'Wacht op voorraad',
          afleverdatum: '2026-10-01',     // wk 40
          standaard_afleverdatum_berekend: '2026-01-05', // wk 2
        },
        { // B — urgent
          id: 200,
          status: 'Wacht op voorraad',
          afleverdatum: '2026-05-25',     // wk 22 (urgent)
          standaard_afleverdatum_berekend: '2026-05-25',
        },
      ],
      orderRegels: [
        { id: 1001, order_id: 100, artikelnr: 'CISCO', te_leveren: 1 },
        { id: 2001, order_id: 200, artikelnr: 'CISCO', te_leveren: 1 },
      ],
      ioRegels: [
        // Past binnen A's wk 40 (verwacht_datum + 7 dagen ≤ 2026-10-01)
        { id: 9001, artikelnr: 'CISCO', eenheid: 'stuks',
          te_leveren_m: 5, verwacht_datum: '2026-07-23', io_status: 'Besteld' },
      ],
      initialClaims: [
        // A claimt al voorraad
        { id: 1, order_regel_id: 1001, bron: 'voorraad',
          inkooporder_regel_id: null, aantal: 1, fysiek_artikelnr: 'CISCO',
          status: 'actief' },
      ],
    },
    triggerOnOrderRegelId: 2001,  // herallocateer voor B
    expected: {
      finalActiveClaims: [
        // A's voorraad-claim is weg, A heeft nu IO-claim
        { order_regel_id: 1001, bron: 'inkooporder_regel', io_regel_id: 9001,
          aantal: 1, fysiek_artikelnr: 'CISCO' },
        // B krijgt voorraad
        { order_regel_id: 2001, bron: 'voorraad', aantal: 1,
          fysiek_artikelnr: 'CISCO' },
      ],
      expectedEvents: [
        { order_id: 100, event_type: 'claim_geswapt_weg',
          metadata_match: { naar_order_id: 200, aantal: 1, io_regel_id: 9001 } },
        { order_id: 200, event_type: 'claim_geswapt_naar',
          metadata_match: { van_order_id: 100, aantal: 1 } },
      ],
    },
  },

  {
    name: 'EDD selectie: 2 A-kandidaten (wk30, wk40) → A wk40 verliest (meeste headroom)',
    given: {
      appConfig: { inkoop_buffer_weken_vast: 1 },
      voorraad: [{ artikelnr: 'CISCO', voorraad: 2 }],
      orders: [
        { id: 100, status: 'Wacht op voorraad',
          afleverdatum: '2026-07-20', // wk 30 — minder headroom
          standaard_afleverdatum_berekend: '2026-01-05' },
        { id: 110, status: 'Wacht op voorraad',
          afleverdatum: '2026-10-01', // wk 40 — meeste headroom → verliest claim eerst
          standaard_afleverdatum_berekend: '2026-01-05' },
        { id: 200, status: 'Wacht op voorraad',
          afleverdatum: '2026-05-25',
          standaard_afleverdatum_berekend: '2026-05-25' },
      ],
      orderRegels: [
        { id: 1001, order_id: 100, artikelnr: 'CISCO', te_leveren: 1 },
        { id: 1011, order_id: 110, artikelnr: 'CISCO', te_leveren: 1 },
        { id: 2001, order_id: 200, artikelnr: 'CISCO', te_leveren: 1 },
      ],
      ioRegels: [
        // Past zowel binnen wk30 als binnen wk40
        { id: 9001, artikelnr: 'CISCO', eenheid: 'stuks',
          te_leveren_m: 5, verwacht_datum: '2026-06-15', io_status: 'Besteld' },
      ],
      initialClaims: [
        { id: 1, order_regel_id: 1001, bron: 'voorraad',
          inkooporder_regel_id: null, aantal: 1, fysiek_artikelnr: 'CISCO',
          status: 'actief' },
        { id: 2, order_regel_id: 1011, bron: 'voorraad',
          inkooporder_regel_id: null, aantal: 1, fysiek_artikelnr: 'CISCO',
          status: 'actief' },
      ],
    },
    triggerOnOrderRegelId: 2001,
    expected: {
      finalActiveClaims: [
        // A wk30 BLIJFT op voorraad (verloor niet)
        { order_regel_id: 1001, bron: 'voorraad', aantal: 1,
          fysiek_artikelnr: 'CISCO' },
        // A wk40 verloor → naar IO
        { order_regel_id: 1011, bron: 'inkooporder_regel', io_regel_id: 9001,
          aantal: 1, fysiek_artikelnr: 'CISCO' },
        // B krijgt voorraad
        { order_regel_id: 2001, bron: 'voorraad', aantal: 1,
          fysiek_artikelnr: 'CISCO' },
      ],
      expectedEvents: [
        { order_id: 110, event_type: 'claim_geswapt_weg',
          metadata_match: { naar_order_id: 200, aantal: 1 } },
        { order_id: 200, event_type: 'claim_geswapt_naar',
          metadata_match: { van_order_id: 110 } },
      ],
    },
  },

  {
    name: 'laatst-passend IO: 3 IO\'s (wk20/25/30), A.afleverdatum=wk40 → IO wk30 wint',
    given: {
      appConfig: { inkoop_buffer_weken_vast: 1 },
      voorraad: [{ artikelnr: 'CISCO', voorraad: 1 }],
      orders: [
        { id: 100, status: 'Wacht op voorraad',
          afleverdatum: '2026-10-01', // wk 40
          standaard_afleverdatum_berekend: '2026-01-05' },
        { id: 200, status: 'Wacht op voorraad',
          afleverdatum: '2026-05-25',
          standaard_afleverdatum_berekend: '2026-05-25' },
      ],
      orderRegels: [
        { id: 1001, order_id: 100, artikelnr: 'CISCO', te_leveren: 1 },
        { id: 2001, order_id: 200, artikelnr: 'CISCO', te_leveren: 1 },
      ],
      ioRegels: [
        { id: 9001, artikelnr: 'CISCO', eenheid: 'stuks',
          te_leveren_m: 5, verwacht_datum: '2026-05-11', // wk 20
          io_status: 'Besteld' },
        { id: 9002, artikelnr: 'CISCO', eenheid: 'stuks',
          te_leveren_m: 5, verwacht_datum: '2026-06-15', // wk 25
          io_status: 'Besteld' },
        { id: 9003, artikelnr: 'CISCO', eenheid: 'stuks',
          te_leveren_m: 5, verwacht_datum: '2026-07-20', // wk 30 — laatst-passend
          io_status: 'Besteld' },
      ],
      initialClaims: [
        { id: 1, order_regel_id: 1001, bron: 'voorraad',
          inkooporder_regel_id: null, aantal: 1, fysiek_artikelnr: 'CISCO',
          status: 'actief' },
      ],
    },
    triggerOnOrderRegelId: 2001,
    expected: {
      finalActiveClaims: [
        // A pakt IO 9003 (verwacht_datum=wk30, meest dichtbij A.afleverdatum=wk40)
        { order_regel_id: 1001, bron: 'inkooporder_regel', io_regel_id: 9003,
          aantal: 1, fysiek_artikelnr: 'CISCO' },
        { order_regel_id: 2001, bron: 'voorraad', aantal: 1,
          fysiek_artikelnr: 'CISCO' },
      ],
      expectedEvents: [
        { order_id: 100, event_type: 'claim_geswapt_weg',
          metadata_match: { io_regel_id: 9003 } },
        { order_id: 200, event_type: 'claim_geswapt_naar', metadata_match: {} },
      ],
    },
  },

  {
    name: 'geen swap: A.afleverdatum == standaard (operator niet bewust later)',
    given: {
      appConfig: { inkoop_buffer_weken_vast: 1 },
      voorraad: [{ artikelnr: 'CISCO', voorraad: 1 }],
      orders: [
        { id: 100, status: 'Nieuw',
          afleverdatum: '2026-05-25',
          standaard_afleverdatum_berekend: '2026-05-25' }, // GELIJK aan standaard
        { id: 200, status: 'Wacht op voorraad',
          afleverdatum: '2026-05-20',
          standaard_afleverdatum_berekend: '2026-05-20' },
      ],
      orderRegels: [
        { id: 1001, order_id: 100, artikelnr: 'CISCO', te_leveren: 1 },
        { id: 2001, order_id: 200, artikelnr: 'CISCO', te_leveren: 1 },
      ],
      ioRegels: [
        { id: 9001, artikelnr: 'CISCO', eenheid: 'stuks',
          te_leveren_m: 5, verwacht_datum: '2026-05-15', io_status: 'Besteld' },
      ],
      initialClaims: [
        { id: 1, order_regel_id: 1001, bron: 'voorraad',
          inkooporder_regel_id: null, aantal: 1, fysiek_artikelnr: 'CISCO',
          status: 'actief' },
      ],
    },
    triggerOnOrderRegelId: 2001,
    expected: {
      finalActiveClaims: [
        // A behoudt voorraad-claim (geen swap-toestemming)
        { order_regel_id: 1001, bron: 'voorraad', aantal: 1,
          fysiek_artikelnr: 'CISCO' },
        // B krijgt IO (val-back, geen voorraad meer)
        { order_regel_id: 2001, bron: 'inkooporder_regel', io_regel_id: 9001,
          aantal: 1, fysiek_artikelnr: 'CISCO' },
      ],
      expectedEvents: [],  // Geen swap-events
    },
  },

  {
    name: 'geen swap: A heeft multi-source (voorraad + IO al)',
    given: {
      appConfig: { inkoop_buffer_weken_vast: 1 },
      voorraad: [{ artikelnr: 'CISCO', voorraad: 1 }],
      orders: [
        { id: 100, status: 'Wacht op inkoop',
          afleverdatum: '2026-10-01',                       // wk 40
          standaard_afleverdatum_berekend: '2026-01-05' },  // later dan standaard
        { id: 200, status: 'Wacht op voorraad',
          afleverdatum: '2026-05-25',
          standaard_afleverdatum_berekend: '2026-05-25' },
      ],
      orderRegels: [
        // A wil 3 stuks, heeft 1 voorraad + 2 IO
        { id: 1001, order_id: 100, artikelnr: 'CISCO', te_leveren: 3 },
        { id: 2001, order_id: 200, artikelnr: 'CISCO', te_leveren: 1 },
      ],
      ioRegels: [
        { id: 9001, artikelnr: 'CISCO', eenheid: 'stuks',
          te_leveren_m: 5, verwacht_datum: '2026-06-15', io_status: 'Besteld' },
      ],
      initialClaims: [
        // A heeft BEIDE voorraad én IO — multi-source, NIET swap-baar (ADR-0027 V1)
        { id: 1, order_regel_id: 1001, bron: 'voorraad',
          inkooporder_regel_id: null, aantal: 1, fysiek_artikelnr: 'CISCO',
          status: 'actief' },
        { id: 2, order_regel_id: 1001, bron: 'inkooporder_regel',
          inkooporder_regel_id: 9001, aantal: 2, fysiek_artikelnr: 'CISCO',
          status: 'actief' },
      ],
    },
    triggerOnOrderRegelId: 2001,
    expected: {
      finalActiveClaims: [
        // A blijft ongewijzigd
        { order_regel_id: 1001, bron: 'voorraad', aantal: 1,
          fysiek_artikelnr: 'CISCO' },
        { order_regel_id: 1001, bron: 'inkooporder_regel', io_regel_id: 9001,
          aantal: 2, fysiek_artikelnr: 'CISCO' },
        // B krijgt IO (geen swap)
        { order_regel_id: 2001, bron: 'inkooporder_regel', io_regel_id: 9001,
          aantal: 1, fysiek_artikelnr: 'CISCO' },
      ],
      expectedEvents: [],
    },
  },

  {
    name: 'geen swap: geen IO past binnen A.afleverdatum',
    given: {
      appConfig: { inkoop_buffer_weken_vast: 1 },
      voorraad: [{ artikelnr: 'CISCO', voorraad: 1 }],
      orders: [
        { id: 100, status: 'Wacht op voorraad',
          afleverdatum: '2026-06-01',                       // wk 23
          standaard_afleverdatum_berekend: '2026-01-05' },  // later dan standaard
        { id: 200, status: 'Wacht op voorraad',
          afleverdatum: '2026-05-25',
          standaard_afleverdatum_berekend: '2026-05-25' },
      ],
      orderRegels: [
        { id: 1001, order_id: 100, artikelnr: 'CISCO', te_leveren: 1 },
        { id: 2001, order_id: 200, artikelnr: 'CISCO', te_leveren: 1 },
      ],
      ioRegels: [
        // verwacht_datum + 7 dagen = 2026-07-07 → te LAAT voor A's wk23-deadline
        { id: 9001, artikelnr: 'CISCO', eenheid: 'stuks',
          te_leveren_m: 5, verwacht_datum: '2026-06-30', io_status: 'Besteld' },
      ],
      initialClaims: [
        { id: 1, order_regel_id: 1001, bron: 'voorraad',
          inkooporder_regel_id: null, aantal: 1, fysiek_artikelnr: 'CISCO',
          status: 'actief' },
      ],
    },
    triggerOnOrderRegelId: 2001,
    expected: {
      finalActiveClaims: [
        // A behoudt voorraad (geen IO past binnen wk23)
        { order_regel_id: 1001, bron: 'voorraad', aantal: 1,
          fysiek_artikelnr: 'CISCO' },
        // B krijgt IO (val-back, geen voorraad meer)
        { order_regel_id: 2001, bron: 'inkooporder_regel', io_regel_id: 9001,
          aantal: 1, fysiek_artikelnr: 'CISCO' },
      ],
      expectedEvents: [],
    },
  },
]

/** Conflict-detect fixture (mig 298). */
export interface ConflictDetectFixture {
  name: string
  given: {
    appConfig: AppConfigFix
    /** Order met al een claim_geswapt_weg-historie. */
    order: OrderFix & { hasPriorSwapWegEvent: boolean }
    /** Laatste IO-claim die nu vertraagt waardoor afleverdatum vooruit moet. */
    laatsteIoClaim: { ir_id: number; verwacht_datum_nieuw: string }
    /** Of er recent (<24u) al een deadline_conflict_na_swap-event was. */
    hasRecentConflictEvent: boolean
  }
  expected: {
    afleverdatumWordtBijgewerkt: boolean
    nieuweAfleverdatum: string | null
    conflictEventEmitted: boolean
    metadata_match?: Record<string, unknown>
  }
}

export const conflictDetectFixtures: ConflictDetectFixture[] = [
  {
    name: 'IO vertraagt → afleverdatum > standaard → conflict-event gelogd',
    given: {
      appConfig: { inkoop_buffer_weken_vast: 1 },
      order: {
        id: 100,
        status: 'Wacht op inkoop',
        afleverdatum: '2026-10-01',                       // wk 40 (was)
        standaard_afleverdatum_berekend: '2026-01-05',
        hasPriorSwapWegEvent: true,                       // had eerder een swap-weg
      },
      laatsteIoClaim: { ir_id: 9001,
        verwacht_datum_nieuw: '2026-10-20' },  // → afleverdatum 2026-10-27 (> wk40)
      hasRecentConflictEvent: false,
    },
    expected: {
      afleverdatumWordtBijgewerkt: true,
      nieuweAfleverdatum: '2026-10-27',  // verwacht_datum + 7
      conflictEventEmitted: true,
      metadata_match: {
        oude_afleverdatum: '2026-10-01',
        nieuwe_afleverdatum: '2026-10-27',
        standaard: '2026-01-05',
      },
    },
  },
  {
    name: 'dedup: recent conflict-event (<24u) → géén nieuwe insert',
    given: {
      appConfig: { inkoop_buffer_weken_vast: 1 },
      order: {
        id: 100,
        status: 'Wacht op inkoop',
        afleverdatum: '2026-10-27',
        standaard_afleverdatum_berekend: '2026-01-05',
        hasPriorSwapWegEvent: true,
      },
      laatsteIoClaim: { ir_id: 9001, verwacht_datum_nieuw: '2026-11-01' },
      hasRecentConflictEvent: true,  // al binnen 24u gelogd
    },
    expected: {
      afleverdatumWordtBijgewerkt: true,
      nieuweAfleverdatum: '2026-11-08',
      conflictEventEmitted: false,
    },
  },
  {
    name: 'geen swap-historie → géén conflict-event (afleverdatum-sync wel)',
    given: {
      appConfig: { inkoop_buffer_weken_vast: 1 },
      order: {
        id: 100,
        status: 'Wacht op inkoop',
        afleverdatum: '2026-10-01',
        standaard_afleverdatum_berekend: '2026-01-05',
        hasPriorSwapWegEvent: false,
      },
      laatsteIoClaim: { ir_id: 9001, verwacht_datum_nieuw: '2026-10-20' },
      hasRecentConflictEvent: false,
    },
    expected: {
      afleverdatumWordtBijgewerkt: true,
      nieuweAfleverdatum: '2026-10-27',
      conflictEventEmitted: false,  // geen prior swap → geen conflict-trigger
    },
  },
]

// ---------------------------------------------------------------------------
// Test-spec (placeholder — vervolg-PR voegt integratie-runner toe)
// ---------------------------------------------------------------------------

describe('claim-swap policy — fixtures (mig 297 — ADR-0027)', () => {
  it('publiceert swap-policy-fixtures als data-contract', () => {
    // Sanity-check: fixture-array is goed gevormd. Echte SQL-uitvoering
    // gebeurt in vervolg-PR (integratie-test-runner tegen Supabase).
    expect(swapPolicyFixtures.length).toBeGreaterThanOrEqual(6)
    for (const f of swapPolicyFixtures) {
      expect(f.name).toBeTruthy()
      expect(f.given.orders.length).toBeGreaterThanOrEqual(2)
      expect(f.triggerOnOrderRegelId).toBeTypeOf('number')
      // Expected events moeten consistent zijn: weg+naar in paren
      const wegCount = f.expected.expectedEvents.filter(
        e => e.event_type === 'claim_geswapt_weg').length
      const naarCount = f.expected.expectedEvents.filter(
        e => e.event_type === 'claim_geswapt_naar').length
      expect(wegCount).toBe(naarCount)
    }
  })

  it.todo(
    'basis: B urgent + A late + IO past binnen A.afleverdatum → swap gebeurt ' +
    '(vereist DB-integratie-runner — zie comment top-of-file)'
  )
  it.todo(
    'EDD selectie: 2 A-kandidaten (wk 30, wk 40), 1 IO (wk 25). ' +
    'A met wk 40 verliest (meeste headroom)'
  )
  it.todo(
    'laatst-passend IO: 3 IO\'s (wk 20, wk 25, wk 30), A.afleverdatum=wk 40. ' +
    'Swap kiest IO wk 30 (laatst-passend)'
  )
  it.todo(
    'geen swap als A.afleverdatum == standaard (operator niet bewust later gekozen)'
  )
  it.todo(
    'geen swap als A heeft multi-source (voorraad + IO al)'
  )
  it.todo(
    'geen swap als geen IO past binnen A.afleverdatum'
  )
})

describe('post-swap conflict-detectie — fixtures (mig 298 — ADR-0027 Ingreep 5)', () => {
  it('publiceert conflict-detect-fixtures als data-contract', () => {
    expect(conflictDetectFixtures.length).toBeGreaterThanOrEqual(3)
    for (const f of conflictDetectFixtures) {
      expect(f.name).toBeTruthy()
      if (f.expected.conflictEventEmitted) {
        expect(f.given.order.hasPriorSwapWegEvent).toBe(true)
        expect(f.given.hasRecentConflictEvent).toBe(false)
      }
    }
  })

  it.todo(
    'IO vertraagt → afleverdatum > standaard → ' +
    'deadline_conflict_na_swap-event gelogd op order'
  )
  it.todo(
    'dedup-window 24u: recent conflict-event → geen nieuwe insert'
  )
  it.todo(
    'geen prior claim_geswapt_weg-event → afleverdatum-sync gebeurt wel, ' +
    'maar geen conflict-event'
  )
})
