import type { OrderVoorstelResult } from '../../hooks/use-order-voorstel'

// Scenario: maatwerk-regel met planning_scenario 'nieuwe_rol_gepland'.
// Er is geen bestaande rol met ruimte — een nieuwe rol is ingepland.
export const fixture08: OrderVoorstelResult = {
  lever_modus_vraag: false,
  claim_summary: { totaal: 1, voorraad: 0, op_inkoop: 1, uitwisselbaar: 0, wacht: 0 },
  regels: [
    {
      regel_id: 'regel-1',
      artikelnr: 'BOSS80-300X400',
      gevraagd: 1,
      beschikbaar_voorraad: 0,
      op_inkoop: 1,
      wacht: 0,
      uitwisselbaar: 0,
      status: 'op_inkoop',
      eerste_io_datum: '2026-05-28',
      planning_scenario: {
        regel_id: 'regel-1',
        scenario: 'nieuwe_rol_gepland',
        snij_datum: '2026-05-30',
        lever_datum: '2026-06-01',
        spoed_toeslag_bedrag: null,
        onderbouwing: 'Capaciteit beschikbaar in week 22; nieuwe rol ingepland.',
      },
      planning_beschikbaar: true,
    },
  ],
}
