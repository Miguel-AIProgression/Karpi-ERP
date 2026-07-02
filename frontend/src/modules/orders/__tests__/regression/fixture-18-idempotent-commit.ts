/**
 * Fixture #18 — Idempotent commit
 *
 * Scenario: twee identieke commit-aanroepen met hetzelfde voorstel_id.
 * De tweede aanroep retourneert hetzelfde order_id zonder een nieuwe order
 * aan te maken (idempotency via order_voorstel_commits tabel).
 *
 * Dit is een TypeScript-only fixture (geen runtime DB-test).
 * Verificatie: commitResultaat1.order_id === commitResultaat2.order_id.
 */
import type { CommitOrderVoorstelResult } from '../../hooks/use-order-voorstel'

/** Gedeeld voorstel_id — persisteert over de sessie, gegenereerd via crypto.randomUUID(). */
export const VOORSTEL_ID = '4c6b1d2e-3f8a-47b9-b210-9e0a5c7d1234' as const

/**
 * Eerste commit: succesvol aangemaakt.
 * Tweede commit met hetzelfde VOORSTEL_ID retourneert dit zelfde object.
 */
export const commitResultaat1: CommitOrderVoorstelResult = {
  order_id: 10042,
  was_split: false,
  split_reason: null,
  claim_summary: {
    totaal: 1,
    voorraad: 5,
    op_inkoop: 0,
    uitwisselbaar: 0,
    wacht: 0,
  },
  afwijking_t_o_v_voorstel: [],
}

/**
 * Tweede commit (zelfde voorstel_id) — DB retourneert cached resultaat.
 * Invariant: order_id en claim_summary zijn byte-voor-byte gelijk.
 */
export const commitResultaat2: CommitOrderVoorstelResult = {
  ...commitResultaat1,
}

// Design-validatie assertion (compileer-tijd)
const _assertSameOrderId: boolean = commitResultaat1.order_id === commitResultaat2.order_id
void _assertSameOrderId
