import { Link } from 'react-router-dom'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatDate, formatCurrency } from '@/lib/utils/formatters'
import type { OrderDetail } from '@/lib/supabase/queries/orders'

interface OrderHeaderProps {
  order: OrderDetail
  locked?: boolean
}

export function OrderHeader({ order, locked = false }: OrderHeaderProps) {
  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6 mb-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="font-[family-name:var(--font-display)] text-2xl">
              {order.order_nr}
            </h2>
            <StatusBadge status={order.status} />
          </div>
          {order.oud_order_nr && (
            <p className="text-sm text-slate-400">
              Oud systeem: {order.oud_order_nr}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {locked ? (
            <span
              className="px-4 py-2 text-sm border border-slate-200 rounded-[var(--radius-sm)] text-slate-400 cursor-not-allowed bg-slate-50"
              title="Order is al (deels) gesneden en kan niet meer worden bewerkt"
            >
              Bewerken
            </span>
          ) : (
            <Link
              to={`/orders/${order.id}/bewerken`}
              className="px-4 py-2 text-sm border border-slate-200 rounded-[var(--radius-sm)] hover:bg-slate-50"
            >
              Bewerken
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <span className="text-slate-500">Klant</span>
          <Link
            to={`/klanten/${order.debiteur_nr}`}
            className="block font-medium text-terracotta-500 hover:underline"
          >
            {order.klant_naam}
          </Link>
        </div>
        <div>
          <span className="text-slate-500">Orderdatum</span>
          <p className="font-medium">{formatDate(order.orderdatum)}</p>
        </div>
        <div>
          <span className="text-slate-500">Afleverdatum</span>
          <p className="font-medium">{formatDate(order.afleverdatum)}</p>
        </div>
        <div>
          <span className="text-slate-500">Vertegenwoordiger</span>
          <p className="font-medium">{order.vertegenw_naam ?? '—'}</p>
        </div>
        <div>
          <span className="text-slate-500">Referentie</span>
          <p className="font-medium">{order.klant_referentie ?? '—'}</p>
        </div>
        <div>
          <span className="text-slate-500">Totaal bedrag</span>
          <p className="font-medium">{formatCurrency(order.totaal_bedrag)}</p>
        </div>
        <div>
          <span className="text-slate-500">Regels</span>
          <p className="font-medium">{order.aantal_regels}</p>
        </div>
        <div>
          <span className="text-slate-500">Gewicht</span>
          <p className="font-medium">{order.totaal_gewicht ? `${order.totaal_gewicht} kg` : '—'}</p>
        </div>
      </div>
    </div>
  )
}
