import type { PickShipOrder } from '../../magazijn/lib/types'
import { normaliseerAdresKey } from '@/lib/orders/normaliseer-adres'

/**
 * Geeft de order_ids terug die tot dezelfde (debiteur × adres-norm)-groep
 * horen als een order in `startOrderIds`, zelf ECHT Combi-levering-deelnemer
 * zijn (`combi_levering_deelnemer=true` — anders is dit gewoon een tweede,
 * niet-gerelateerde order van dezelfde klant naar hetzelfde adres) en toch
 * NIET in `startOrderIds` zitten — d.w.z. een Combi-levering-lid dat de
 * operator op het punt staat achter te laten door 'm niet aan te vinken. Pure
 * functie, geen fetch.
 *
 * Mig 563-566 (ADR-0040): sinds de wacht-beslissing zelf in `orders.status`
 * zit (order bereikt Pick & Ship pas als hij écht startbaar is,
 * order_pickbaarheid-guard), is elke order die hier binnenkomt per definitie
 * al startbaar — de vroegere `wacht_op_combi_levering`-check is dus vervallen.
 * Deze functie beschermt nu specifiek tegen de resterende use-case: een
 * operator die in Pick & Ship handmatig een subset van een al-zichtbare,
 * al-startbare Combi-levering-groep selecteert.
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
    .filter((o) => o.combi_levering_deelnemer)
    .filter((o) => sleutels.has(`${o.debiteur_nr}|${normaliseerAdresKey(o)}`))
    .map((o) => o.order_id)
}
