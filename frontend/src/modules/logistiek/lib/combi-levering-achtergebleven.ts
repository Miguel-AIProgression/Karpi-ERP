import type { PickShipOrder } from '../../magazijn/lib/types'
import { normaliseerAdresKey } from '@/lib/orders/normaliseer-adres'

/**
 * Geeft de order_ids terug die tot dezelfde (debiteur × adres-norm)-groep
 * horen als een order in `startOrderIds`, zelf nu ook startbaar zijn
 * (wacht_op_combi_levering=false) en toch NIET in `startOrderIds` zitten —
 * d.w.z. een Combi-levering-lid dat de operator op het punt staat achter te
 * laten door 'm niet aan te vinken. Pure functie, geen fetch.
 */
export function vindtAchtergeblevenCombiLeveringLeden(
  startOrderIds: number[],
  alleOrders: PickShipOrder[],
): number[] {
  const startSet = new Set(startOrderIds)
  const geselecteerd = alleOrders.filter((o) => startSet.has(o.order_id))
  const sleutels = new Set(geselecteerd.map((o) => `${o.debiteur_nr}|${normaliseerAdresKey(o)}`))
  if (sleutels.size === 0) return []

  return alleOrders
    .filter((o) => !startSet.has(o.order_id))
    .filter((o) => !o.wacht_op_combi_levering)
    .filter((o) => sleutels.has(`${o.debiteur_nr}|${normaliseerAdresKey(o)}`))
    .map((o) => o.order_id)
}
