import { Link } from 'react-router-dom'
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency, formatDate } from '@/lib/utils/formatters'
import type { OrderRow, OrderSortField, SortDirection } from '@/lib/supabase/queries/orders'

interface OrdersTableProps {
  orders: OrderRow[]
  isLoading: boolean
  sortBy: OrderSortField
  sortDir: SortDirection
  onSort: (field: OrderSortField) => void
}

function SortIcon({ field, sortBy, sortDir }: { field: OrderSortField; sortBy: OrderSortField; sortDir: SortDirection }) {
  if (field !== sortBy) return <ArrowUpDown size={14} className="text-slate-300" />
  return sortDir === 'asc'
    ? <ArrowUp size={14} className="text-terracotta-500" />
    : <ArrowDown size={14} className="text-terracotta-500" />
}

function SortHeader({ field, label, align = 'left', sortBy, sortDir, onSort }: {
  field: OrderSortField
  label: string
  align?: 'left' | 'right'
  sortBy: OrderSortField
  sortDir: SortDirection
  onSort: (field: OrderSortField) => void
}) {
  return (
    <th
      className={`text-${align} px-4 py-3 font-medium text-slate-600 cursor-pointer select-none hover:text-slate-900 transition-colors`}
      onClick={() => onSort(field)}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        <SortIcon field={field} sortBy={sortBy} sortDir={sortDir} />
      </span>
    </th>
  )
}

export function OrdersTable({ orders, isLoading, sortBy, sortDir, onSort }: OrdersTableProps) {
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

  const sortProps = { sortBy, sortDir, onSort }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50">
            <SortHeader field="order_nr" label="Order" {...sortProps} />
            <SortHeader field="orderdatum" label="Datum" {...sortProps} />
            <SortHeader field="klant_naam" label="Klant" {...sortProps} />
            <th className="text-left px-4 py-3 font-medium text-slate-600">Referentie</th>
            <SortHeader field="aantal_regels" label="Regels" align="right" {...sortProps} />
            <SortHeader field="totaal_bedrag" label="Bedrag" align="right" {...sortProps} />
            <SortHeader field="status" label="Status" {...sortProps} />
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
