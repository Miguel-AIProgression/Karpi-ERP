import type { OrderVoorstelResult } from '../../hooks/use-order-voorstel'

export const fixture01: OrderVoorstelResult = {
  lever_modus_vraag: false,
  claim_summary: { totaal: 1, voorraad: 1, op_inkoop: 0, wacht: 0 },
  regels: [
    {
      regel_id: 'regel-1',
      artikelnr: 'FREZ50-200X140',
      gevraagd: 5,
      beschikbaar_voorraad: 10,
      status: 'voorraad',
    },
  ],
}
