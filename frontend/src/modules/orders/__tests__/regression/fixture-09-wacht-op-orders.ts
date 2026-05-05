import type { OrderVoorstelResult } from '../../hooks/use-order-voorstel'

// Scenario: maatwerk-regel met planning_scenario 'wacht_op_orders'.
// Capaciteit vol; lever_datum onbekend — wacht op vrijkomende planningscapaciteit.
export const fixture09: OrderVoorstelResult = {
  lever_modus_vraag: false,
  claim_summary: { totaal: 1, voorraad: 0, op_inkoop: 0, uitwisselbaar: 0, wacht: 1 },
  regels: [
    {
      regel_id: 'regel-1',
      artikelnr: 'KANT99-200X300',
      gevraagd: 1,
      beschikbaar_voorraad: 0,
      op_inkoop: 0,
      wacht: 1,
      uitwisselbaar: 0,
      status: 'wacht_op_nieuwe_inkoop',
      eerste_io_datum: null,
      planning_scenario: {
        regel_id: 'regel-1',
        scenario: 'wacht_op_orders',
        snij_datum: null,
        lever_datum: null,
        spoed_toeslag_bedrag: null,
        onderbouwing: 'Planning vol; wacht op vrijgekomen capaciteit.',
      },
      planning_beschikbaar: true,
    },
  ],
}
