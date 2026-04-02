import { Link } from 'react-router-dom'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency, formatDate } from '@/lib/utils/formatters'
import type { OrderRow } from '@/lib/supabase/queries/orders'

interface OrdersTableProps {
  orders: OrderRow[]
  isLoading: boolean
}

export function OrdersTable({ orders, isLoading }: OrdersTableProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
        Orders laden...
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
        Geen orders gevonden
      </div>
    )
  }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Order</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Datum</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Klant</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Referentie</th>
            <th className="text-right px-4 py-3 font-medium text-slate-600">Regels</th>
            <th className="text-right px-4 py-3 font-medium text-slate-600">Bedrag</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr
              key={order.id}
              className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
            >
              <td className="px-4 py-3">
                <Link
                  to={`/orders/${order.id}`}
                  className="text-terracotta-500 hover:underline font-medium"
                >
                  {order.order_nr}
                </Link>
                {order.oud_order_nr && (
                  <span className="block text-xs text-slate-400">
                    Oud: {order.oud_order_nr}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-slate-600">
                {formatDate(order.orderdatum)}
              </td>
              <td className="px-4 py-3">
                <Link
                  to={`/klanten/${order.debiteur_nr}`}
                  className="hover:text-terracotta-500"
                >
                  {order.klant_naam}
                </Link>
                <span className="block text-xs text-slate-400">
                  #{order.debiteur_nr}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-600 max-w-48 truncate" title={order.klant_referentie ?? ''}>
                {order.klant_referentie ?? '—'}
              </td>
              <td className="px-4 py-3 text-right text-slate-600">
                {order.aantal_regels}
              </td>
              <td className="px-4 py-3 text-right font-medium">
                {formatCurrency(order.totaal_bedrag)}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={order.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
