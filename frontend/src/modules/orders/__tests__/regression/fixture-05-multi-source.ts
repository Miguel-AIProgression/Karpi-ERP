import type { OrderVoorstelResult } from '../../hooks/use-order-voorstel'

// Scenario: 2 regels — regel-1 volledig uit voorraad, regel-2 deels op inkoop.
// Debiteur met deelleveringen_toegestaan = true → lever_modus_vraag = true.
export const fixture05: OrderVoorstelResult = {
  lever_modus_vraag: true,
  claim_summary: { totaal: 2, voorraad: 1, op_inkoop: 1, uitwisselbaar: 0, wacht: 0 },
  regels: [
    {
      regel_id: 'regel-1',
      artikelnr: 'FREZ50-200X300',
      gevraagd: 4,
      beschikbaar_voorraad: 6,
      op_inkoop: 0,
      wacht: 0,
      uitwisselbaar: 0,
      status: 'voorraad',
      eerste_io_datum: null,
    },
    {
      regel_id: 'regel-2',
      artikelnr: 'BOSS80-160X230',
      gevraagd: 3,
      beschikbaar_voorraad: 1,
      op_inkoop: 2,
      wacht: 0,
      uitwisselbaar: 0,
      status: 'op_inkoop',
      eerste_io_datum: '2026-06-20',
    },
  ],
}
