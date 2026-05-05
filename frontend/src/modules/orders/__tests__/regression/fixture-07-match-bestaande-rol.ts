import type { OrderVoorstelResult } from '../../hooks/use-order-voorstel'

// Scenario: maatwerk-regel met planning_scenario 'match_bestaande_rol'.
// De planning-seam heeft een passende bestaande rol gevonden — snij + lever datum bekend.
export const fixture07: OrderVoorstelResult = {
  lever_modus_vraag: false,
  claim_summary: { totaal: 1, voorraad: 1, op_inkoop: 0, uitwisselbaar: 0, wacht: 0 },
  regels: [
    {
      regel_id: 'regel-1',
      artikelnr: 'FREZ50-200X140',
      gevraagd: 1,
      beschikbaar_voorraad: 0,
      op_inkoop: 0,
      wacht: 0,
      uitwisselbaar: 0,
      status: 'voorraad',
      eerste_io_datum: null,
      planning_scenario: {
        regel_id: 'regel-1',
        scenario: 'match_bestaande_rol',
        snij_datum: '2026-05-20',
        lever_datum: '2026-05-22',
        spoed_toeslag_bedrag: null,
        onderbouwing: 'Passende rol gevonden in week 21.',
      },
      planning_beschikbaar: true,
    },
  ],
}
