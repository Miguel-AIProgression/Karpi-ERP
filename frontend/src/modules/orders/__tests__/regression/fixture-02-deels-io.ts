import type { OrderVoorstelResult } from '../../hooks/use-order-voorstel'

// Scenario: 1 regel — 3 stuks op voorraad, 2 stuks gedekt via inkooporder.
// Debiteur heeft deelleveringen_toegestaan = true → lever_modus_vraag = true.
export const fixture02: OrderVoorstelResult = {
  lever_modus_vraag: true,
  claim_summary: { totaal: 1, voorraad: 0, op_inkoop: 1, uitwisselbaar: 0, wacht: 0 },
  regels: [
    {
      regel_id: 'regel-1',
      artikelnr: 'FREZ50-200X140',
      gevraagd: 5,
      beschikbaar_voorraad: 3,
      op_inkoop: 2,
      wacht: 0,
      uitwisselbaar: 0,
      status: 'op_inkoop',
      eerste_io_datum: '2026-06-15',
    },
  ],
}
