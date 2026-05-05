import type { OrderVoorstelResult } from '../../hooks/use-order-voorstel'

// Scenario: 1 regel — 2 stuks handmatig geclaimd via uitwisselbaar product,
// resterende 3 stuks volledig gedekt door eigen voorraad.
export const fixture04: OrderVoorstelResult = {
  lever_modus_vraag: false,
  claim_summary: { totaal: 1, voorraad: 1, op_inkoop: 0, uitwisselbaar: 1, wacht: 0 },
  regels: [
    {
      regel_id: 'regel-1',
      artikelnr: 'FREZ50-200X140',
      gevraagd: 5,
      beschikbaar_voorraad: 3,
      op_inkoop: 0,
      wacht: 0,
      uitwisselbaar: 2,
      status: 'voorraad',
      eerste_io_datum: null,
      planning_scenario: null,
      planning_beschikbaar: false,
    },
  ],
}
