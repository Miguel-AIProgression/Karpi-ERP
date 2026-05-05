import type { OrderVoorstelResult } from '../../hooks/use-order-voorstel'

// Scenario: maatwerk-regel met planning_scenario 'spoed_mogelijk'.
// Spoed-snij beschikbaar mits toeslag van €75 wordt geaccepteerd.
export const fixture10: OrderVoorstelResult = {
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
      planning_scenario: {
        regel_id: 'regel-1',
        scenario: 'spoed_mogelijk',
        snij_datum: '2026-05-07',
        lever_datum: '2026-05-09',
        spoed_toeslag_bedrag: 75,
        onderbouwing: 'Spoedcapaciteit beschikbaar; toeslag €75 van toepassing.',
      },
      planning_beschikbaar: true,
    },
  ],
}
