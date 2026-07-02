/**
 * Fixture #19 — Drift tijdens commit
 *
 * Scenario: voorstel toont 5 stuks beschikbaar op voorraad, maar tussen
 * bouw_order_voorstel (simulatie) en commit_order_voorstel (echte allocatie)
 * is een concurrent order aangemaakt die 3 stuks heeft weggegrabeld.
 *
 * Resultaat: herallocateer_orderregel geeft slechts 2 stuks uit voorraad terug.
 * De overige 3 stuks staan in afwijking_t_o_v_voorstel.
 *
 * Dit is een TypeScript-only fixture (geen runtime DB-test).
 */
import type { CommitOrderVoorstelResult } from '../../hooks/use-order-voorstel'

/** Gesimuleerde dekking vóór commit (bouw_order_voorstel output). */
export const gesimuleerdGedekt = 5

/** Werkelijk gedekte hoeveelheid na commit (herallocateer_orderregel resultaat). */
export const werkelijkGedekt = 2

export const commitMetDrift: CommitOrderVoorstelResult = {
  order_id: 10043,
  was_split: false,
  split_reason: null,
  claim_summary: {
    totaal: 1,
    voorraad: 2,
    op_inkoop: 0,
    uitwisselbaar: 0,
    wacht: 3,
  },
  afwijking_t_o_v_voorstel: [
    {
      regel_id: 'r1',
      gevraagd: gesimuleerdGedekt,
      gekregen: werkelijkGedekt,
    },
  ],
}

// Design-validatie: afwijking_t_o_v_voorstel mag niet leeg zijn bij drift
const _assertAfwijkingAanwezig: boolean =
  commitMetDrift.afwijking_t_o_v_voorstel.length > 0
void _assertAfwijkingAanwezig

// Design-validatie: gekregen < gevraagd
const _assertDrift: boolean =
  commitMetDrift.afwijking_t_o_v_voorstel[0].gekregen <
  commitMetDrift.afwijking_t_o_v_voorstel[0].gevraagd
void _assertDrift
