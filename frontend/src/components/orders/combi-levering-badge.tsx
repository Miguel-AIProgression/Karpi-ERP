import { Link2 } from 'lucide-react'
import type { OrderRow } from '@/lib/supabase/queries/orders'

/** Mig 563 (ADR-0039/0040): Combi-levering-groep — orders die samen wachten
 *  op (of net) de vrachtvrije-drempel (hebben) gehaald, om verzendkosten te
 *  besparen. Eén bron voor orders-overview (orders-table.tsx) én order-detail
 *  (order-header.tsx) — los van en anders gestyled dan de fysieke
 *  zending-bundel-chip (mig 222, andere reden: al daadwerkelijk verzonden). */
export function CombiLeveringBadge({ order }: { order: Pick<OrderRow, 'combi_levering_aantal_orders' | 'combi_levering_andere_orders' | 'wacht_op_combi_levering'> }) {
  const aantal = order.combi_levering_aantal_orders
  if (!aantal || aantal < 2) return null
  const andere = order.combi_levering_andere_orders ?? []
  const anderNrs = andere.map((o) => o.order_nr).join(', ')
  const wacht = order.wacht_op_combi_levering
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-indigo-100 text-indigo-700 px-2 py-0.5 text-xs font-semibold"
      title={
        wacht
          ? `Wacht samen met ${anderNrs || 'andere orders'} op de vrachtvrije-drempel`
          : `Wordt samen met ${anderNrs || 'andere orders'} verzonden (vrachtvrije-drempel gehaald)`
      }
    >
      <Link2 size={12} />
      Combi-levering ({aantal})
    </span>
  )
}
