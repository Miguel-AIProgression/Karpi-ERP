import type { OrderVoorstelResult } from '../../hooks/use-order-voorstel'

// Scenario: 2 maatwerk-regels in 1 batch (max 2 per batch).
// regel-1 heeft een planning_scenario; regel-2: planning_unavailable.
// Demonstreert gedeeltelijke planningsfailure binnen één batch.
export const fixture12: OrderVoorstelResult = {
  lever_modus_vraag: false,
  claim_summary: { totaal: 2, voorraad: 1, op_inkoop: 0, uitwisselbaar: 0, wacht: 1 },
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
    {
      regel_id: 'regel-2',
      artikelnr: 'BOSS80-300X400',
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
