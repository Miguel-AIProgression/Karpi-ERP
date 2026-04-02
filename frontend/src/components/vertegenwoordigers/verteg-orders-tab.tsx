import { useState } from 'react'
import { Link } from 'react-router-dom'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency, formatDate } from '@/lib/utils/formatters'
import { useVertegOrders } from '@/hooks/use-vertegenwoordigers'

interface Props {
  code: string
}

const STATUS_FILTERS = [
  { key: undefined, label: 'Alle' },
  { key: 'open', label: 'Open' },
  { key: 'afgerond', label: 'Afgerond' },
] as const

export function VertegOrdersTab({ code }: Props) {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const { data: orders, isLoading } = useVertegOrders(code, statusFilter)

  return (
    <div>
      {/* Status filter */}
      <div className="flex gap-1 px-5 py-3 border-b border-slate-100">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key ?? 'alle'}
            onClick={() => setStatusFilter(f.key)}
            className={`px-3 py-1 text-xs rounded-[var(--radius-sm)] font-medium transition-colors ${
              statusFilter === f.key
                ? 'bg-terracotta-500 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="p-5 text-sm text-slate-400">Laden...</div>
      ) : !orders || orders.length === 0 ? (
        <div className="p-5 text-sm text-slate-400">Geen orders gevonden</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-5 py-2 font-medium">Order</th>
              <th className="px-5 py-2 font-medium">Klant</th>
              <th className="px-5 py-2 font-medium">Datum</th>
              <th className="px-5 py-2 font-medium">Status</th>
              <th className="px-5 py-2 font-medium text-right">Bedrag</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="px-5 py-2">
                  <Link
                    to={`/orders/${o.id}`}
                    className="text-terracotta-500 hover:underline font-medium"
                  >
                    {o.order_nr}
                  </Link>
                </td>
                <td className="px-5 py-2">
                  <Link
                    to={`/klanten/${o.debiteur_nr}`}
                    className="text-slate-700 hover:underline"
                  >
                    {o.klant_naam ?? `#${o.debiteur_nr}`}
                  </Link>
                </td>
                <td className="px-5 py-2 text-slate-500">{formatDate(o.orderdatum)}</td>
                <td className="px-5 py-2">
                  <StatusBadge status={o.status} />
                </td>
                <td className="px-5 py-2 text-right font-medium">{formatCurrency(o.totaal_bedrag)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
