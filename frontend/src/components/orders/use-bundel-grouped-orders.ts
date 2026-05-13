import { useMemo } from 'react'
import type { OrderRow } from '@/lib/supabase/queries/orders'

/** Eén logische rij in het orders-overzicht: een bundel met N orders
 *  of een solo-order. ADR-0016 / mig 259. */
export type OrdersListItem =
  | { kind: 'bundel'; zending_nr: string; orders: OrderRow[] }
  | { kind: 'solo'; order: OrderRow }

/** Groepeert OrderRow[] op bundel_zending_nr. Orders zonder bundel komen
 *  als solo terug. Volgorde van orders binnen een bundel: oplopend op order_nr.
 *  Volgorde van bundels onderling: positie van de eerste bundel-order in de
 *  input — sortering van de tabel blijft dus gerespecteerd (eerste rij van
 *  een bundel bepaalt zijn positie). */
export function useBundelGroupedOrders(orders: OrderRow[]): OrdersListItem[] {
  return useMemo(() => {
    const seen = new Set<string>()
    const items: OrdersListItem[] = []

    for (const order of orders) {
      const bundelNr = order.bundel_zending_nr
      if (!bundelNr || (order.bundel_order_count ?? 0) < 2) {
        items.push({ kind: 'solo', order })
        continue
      }
      if (seen.has(bundelNr)) continue
      seen.add(bundelNr)

      const bundelOrders = orders
        .filter((o) => o.bundel_zending_nr === bundelNr)
        .sort((a, b) => a.order_nr.localeCompare(b.order_nr))

      items.push({ kind: 'bundel', zending_nr: bundelNr, orders: bundelOrders })
    }

    return items
  }, [orders])
}
