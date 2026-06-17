// Pure helper voor de Pick & Ship afrond-modus (besluit 17-06-2026): vertaal de
// geselecteerde orders naar de unieke pickronde-zendingen die afgerond moeten
// worden. Een bundel-zending hoort bij meerdere orders (zending_orders M2M,
// mig 222) maar moet één keer voltooid worden — dedupliceren op zending_id
// voorkomt dat `voltooi_pickronden` dezelfde zending dubbel meekrijgt.
import type { PickShipOrder } from './types'

export interface AfrondZending {
  zending_id: number
  zending_nr: string
}

/**
 * Unieke actieve-pickronde-zendingen achter een set geselecteerde orders.
 * Orders zonder lopende pickronde leveren niets op (niet afrondbaar).
 */
export function zendingenVoorAfronden(orders: PickShipOrder[]): AfrondZending[] {
  const map = new Map<number, AfrondZending>()
  for (const o of orders) {
    const ap = o.actieve_pickronde
    if (ap) map.set(ap.zending_id, { zending_id: ap.zending_id, zending_nr: ap.zending_nr })
  }
  return Array.from(map.values())
}
