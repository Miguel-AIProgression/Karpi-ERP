import type { OrderVoorstelResult } from '../../hooks/use-order-voorstel'

// Scenario: 1 regel — 0 voorraad, 0 IO-ruimte, alle 5 stuks ongedekt.
// lever_modus_vraag = false: debiteur heeft geen deelleveringen_toegestaan,
// en/of er is geen inkoop die deelleveringen zinvol maakt.
export const fixture06: OrderVoorstelResult = {
  lever_modus_vraag: false,
  claim_summary: { totaal: 1, voorraad: 0, op_inkoop: 0, uitwisselbaar: 0, wacht: 1 },
  regels: [
    {
      regel_id: 'regel-1',
      artikelnr: 'KANT99-300X400',
      gevraagd: 5,
      beschikbaar_voorraad: 0,
      op_inkoop: 0,
      wacht: 5,
      uitwisselbaar: 0,
      status: 'wacht_op_nieuwe_inkoop',
      eerste_io_datum: null,
    },
  ],
}
