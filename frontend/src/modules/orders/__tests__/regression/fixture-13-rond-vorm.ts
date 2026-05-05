import type { OrderVoorstelResult } from '../../hooks/use-order-voorstel'

// Scenario: maatwerk-regel met vorm 'rond'.
// Planning-seam retourneert scenario 'match_bestaande_rol' ondanks ronde vorm
// (de planning-seam houdt rekening met de bounding-box van de vorm).
// Concept-input bevat vorm: 'rond' — doorgestuurd naar planning-seam.
export const fixture13: OrderVoorstelResult = {
  lever_modus_vraag: false,
  claim_summary: { totaal: 1, voorraad: 1, op_inkoop: 0, uitwisselbaar: 0, wacht: 0 },
  regels: [
    {
      regel_id: 'regel-1',
      artikelnr: 'FREZ50-200X200',
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
        snij_datum: '2026-05-21',
        lever_datum: '2026-05-23',
        spoed_toeslag_bedrag: null,
        onderbouwing: 'Ronde vorm past binnen bounding-box van rol in week 21.',
      },
      planning_beschikbaar: true,
    },
  ],
}
