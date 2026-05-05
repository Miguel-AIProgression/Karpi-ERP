import type { OrderVoorstelResult } from '../../hooks/use-order-voorstel'

// Scenario: maatwerk-regel met afwerking 'ZO' (zonder omzoming — geen lane).
// Afwerkingen ZO/ON hebben geen confectie-lane en verschijnen onder "alleen stickeren".
// Planning-seam geeft wel een scenario terug (match_bestaande_rol) — planning_beschikbaar: true.
// Geen spoed-toeslag van toepassing.
export const fixture14: OrderVoorstelResult = {
  lever_modus_vraag: false,
  claim_summary: { totaal: 1, voorraad: 1, op_inkoop: 0, uitwisselbaar: 0, wacht: 0 },
  regels: [
    {
      regel_id: 'regel-1',
      artikelnr: 'BOSS80-160X230',
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
        snij_datum: '2026-05-19',
        lever_datum: '2026-05-21',
        spoed_toeslag_bedrag: null,
        onderbouwing: 'ZO-afwerking — enkel snijden en stickeren; passende rol beschikbaar.',
      },
      planning_beschikbaar: true,
    },
  ],
}
