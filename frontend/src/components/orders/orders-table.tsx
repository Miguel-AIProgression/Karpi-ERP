import { Link } from 'react-router-dom'
import { ArrowUp, ArrowDown, ArrowUpDown, AlertCircle } from 'lucide-react'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency, formatDate } from '@/lib/utils/formatters'
import { verzendWeekVoor } from '@/lib/orders/verzendweek'
import type { OrderRow, OrderSortField, SortDirection } from '@/lib/supabase/queries/orders'
import type { FactuurVoorOrder } from '@/modules/facturatie'

interface OrdersTableProps {
  orders: OrderRow[]
  isLoading: boolean
  sortBy: OrderSortField
  sortDir: SortDirection
  onSort: (field: OrderSortField) => void
  facturenPerOrder?: Map<number, FactuurVoorOrder[]>
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

export function OrdersTable({ orders, isLoading, sortBy, sortDir, onSort, facturenPerOrder }: OrdersTableProps) {
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
            <SortHeader field="orderdatum" label="Orderdatum" {...sortProps} />
            <SortHeader field="afleverdatum" label="Verzendweek" {...sortProps} />
            <SortHeader field="klant_naam" label="Klant" {...sortProps} />
            <th className="text-left px-4 py-3 font-medium text-slate-600">Referentie</th>
            <SortHeader field="aantal_regels" label="Regels" align="right" {...sortProps} />
            <SortHeader field="totaal_bedrag" label="Bedrag" align="right" {...sortProps} />
            <SortHeader field="status" label="Status" {...sortProps} />
            <th className="text-left px-4 py-3 font-medium text-slate-600">Factuur</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr
              key={order.id}
              className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Link
                    to={`/orders/${order.id}`}
                    className="text-terracotta-500 hover:underline font-medium"
                  >
                    {order.order_nr}
                  </Link>
                  {order.heeft_unmatched_regels && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-medium"
                      title="Deze order bevat regels zonder gekoppeld artikelnummer — review nodig"
                    >
                      <AlertCircle size={12} />
                      Actie vereist
                    </span>
                  )}
                </div>
                {order.oud_order_nr && (
                  <span className="block text-xs text-slate-400">
                    Oud: {order.oud_order_nr}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                {formatDate(order.orderdatum)}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {order.lever_type === 'datum' && order.afleverdatum ? (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-terracotta-50 text-terracotta-700 text-xs font-medium"
                    title={`Specifieke leverdag: ${formatDate(order.afleverdatum)}`}
                  >
                    <span aria-hidden>📅</span>
                    {formatDate(order.afleverdatum)}
                  </span>
                ) : (
                  (() => {
                    const w = verzendWeekVoor(order.afleverdatum)
                    return w ? (
                      <span className="text-slate-900 font-medium" title={formatDate(order.afleverdatum)}>
                        Wk {w.week} · {w.jaar}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )
                  })()
                )}
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
              <td className="px-4 py-3 whitespace-nowrap">
                {(() => {
                  const lijst = facturenPerOrder?.get(order.id) ?? []
                  if (lijst.length === 0) {
                    return <span className="text-slate-300">—</span>
                  }
                  const eerste = lijst[0]
                  return (
                    <Link
                      to={`/facturatie/${eerste.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-mono text-xs text-terracotta-500 hover:underline"
                      title={`${eerste.status} · ${formatDate(eerste.factuurdatum)}`}
                    >
                      {eerste.factuur_nr}
                      {lijst.length > 1 && (
                        <span className="ml-1 text-slate-400">+{lijst.length - 1}</span>
                      )}
                    </Link>
                  )
                })()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
