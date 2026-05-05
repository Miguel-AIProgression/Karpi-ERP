import type { OrderVoorstelResult } from '../../hooks/use-order-voorstel'

// Scenario: planning-seam niet beschikbaar (planning_unavailable).
// UI toont "kan levertijd niet bepalen" — geen fallback naar berekenAfleverdatum().
export const fixture11: OrderVoorstelResult = {
  lever_modus_vraag: false,
  claim_summary: { totaal: 1, voorraad: 0, op_inkoop: 0, uitwisselbaar: 0, wacht: 1 },
  regels: [
    {
      regel_id: 'regel-1',
      artikelnr: 'FREZ50-160X230',
      gevraagd: 1,
      beschikbaar_voorraad: 0,
      op_inkoop: 0,
      wacht: 1,
      uitwisselbaar: 0,
      status: 'wacht_op_nieuwe_inkoop',
      eerste_io_datum: null,
      planning_scenario: null,
      planning_beschikbaar: false,
    },
  ],
}
