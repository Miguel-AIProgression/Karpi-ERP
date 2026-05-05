import type { OrderVoorstelResult } from '../../hooks/use-order-voorstel'

// Scenario: order met klanteigen artikelnaam (omstickering). Het voorstel
// evalueert op het onderliggende artikelnr; de klanteigen naam is UI-only.
export const fixture20: OrderVoorstelResult = {
  lever_modus_vraag: false,
  claim_summary: { totaal: 2, voorraad: 2, op_inkoop: 0, uitwisselbaar: 0, wacht: 0 },
  regels: [
    {
      regel_id: 'regel-1',
      artikelnr: 'FREZ50-200X300',
      gevraagd: 3,
      beschikbaar_voorraad: 8,
      op_inkoop: 0,
      wacht: 0,
      uitwisselbaar: 0,
      status: 'voorraad',
      eerste_io_datum: null,
    },
    {
      regel_id: 'regel-2',
      artikelnr: 'BOSS80-160X230',
      gevraagd: 2,
      beschikbaar_voorraad: 5,
      op_inkoop: 0,
      wacht: 0,
      uitwisselbaar: 0,
      status: 'voorraad',
      eerste_io_datum: null,
    },
  ],
}
