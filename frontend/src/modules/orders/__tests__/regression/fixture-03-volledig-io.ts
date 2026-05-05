import type { OrderVoorstelResult } from '../../hooks/use-order-voorstel'

// Scenario: 1 regel — 0 stuks op voorraad, alle 5 gedekt via inkooporder.
export const fixture03: OrderVoorstelResult = {
  lever_modus_vraag: true,
  claim_summary: { totaal: 1, voorraad: 0, op_inkoop: 1, uitwisselbaar: 0, wacht: 0 },
  regels: [
    {
      regel_id: 'regel-1',
      artikelnr: 'BOSS80-160X230',
      gevraagd: 5,
      beschikbaar_voorraad: 0,
      op_inkoop: 5,
      wacht: 0,
      uitwisselbaar: 0,
      status: 'op_inkoop',
      eerste_io_datum: '2026-07-01',
      planning_scenario: null,
      planning_beschikbaar: false,
    },
  ],
}
