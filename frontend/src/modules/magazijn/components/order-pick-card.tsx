import { Link } from 'react-router-dom'
import { CheckCircle2, Clock, ExternalLink } from 'lucide-react'
import { LocatieEdit } from './locatie-edit'
import { VerzendsetButton, VervoerderTag } from '@/modules/logistiek'
import { formatDate } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import { ORDER_STATUS_COLORS } from '@/lib/utils/constants'
import type { PickShipOrder, PickShipWachtOp } from '../lib/types'

const WACHT_OP_LABEL: Record<NonNullable<PickShipWachtOp>, string> = {
  snijden: 'Wacht op snijden',
  confectie: 'Wacht op confectie',
  inpak: 'Wacht op inpak',
  inkoop: 'Wacht op inkoop',
}

interface Props {
  order: PickShipOrder
}

export function OrderPickCard({ order }: Props) {
  const statusColor = ORDER_STATUS_COLORS[order.status] ?? {
    bg: 'bg-slate-100',
    text: 'text-slate-700',
  }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/orders/${order.order_id}`}
              className="inline-flex items-center gap-1 text-terracotta-600 font-medium hover:underline"
            >
              {order.order_nr}
              <ExternalLink size={12} />
            </Link>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                statusColor.bg,
                statusColor.text
              )}
            >
              {order.status}
            </span>
          </div>
          <div className="text-sm text-slate-700 mt-0.5">{order.klant_naam}</div>
          {order.afl_naam && (
            <div className="text-xs text-slate-500 mt-0.5">
              → {order.afl_naam}{order.afl_plaats ? `, ${order.afl_plaats}` : ''}
            </div>
          )}
        </div>
        <div className="flex items-start gap-4">
          <div className="text-right text-sm">
          <div className="text-slate-700 font-medium">{formatDate(order.afleverdatum)}</div>
          <div className="text-xs text-slate-500">
            {order.aantal_regels} regel{order.aantal_regels === 1 ? '' : 's'}
            {order.totaal_m2 > 0 ? ` · ${order.totaal_m2.toFixed(2)} m²` : ''}
          </div>
            <div className="mt-1 flex justify-end">
              <VervoerderTag showLeeg />
            </div>
          </div>
          <VerzendsetButton order={order} />
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
            <th className="py-1.5 px-3 font-medium w-8"></th>
            <th className="py-1.5 px-3 font-medium">Product</th>
            <th className="py-1.5 px-3 font-medium">Type · Maat</th>
            <th className="py-1.5 px-3 font-medium">Status</th>
            <th className="py-1.5 px-3 font-medium">Locatie</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {order.regels.map((r) => (
            <tr
              key={r.order_regel_id}
              className={cn('hover:bg-slate-50', !r.is_pickbaar && 'opacity-70')}
            >
              <td className="py-2 px-3">
                {r.is_pickbaar ? (
                  <CheckCircle2 size={16} className="text-emerald-500" />
                ) : (
                  <Clock size={16} className="text-amber-500" />
                )}
              </td>
              <td className="py-2 px-3">
                <span className="text-slate-700">{r.product}</span>
                {r.kleur && <span className="text-slate-400 ml-1 text-xs">({r.kleur})</span>}
                {r.artikelnr && !r.is_maatwerk && (
                  <span className="text-slate-400 ml-1 text-xs">{r.artikelnr}</span>
                )}
              </td>
              <td className="py-2 px-3 text-xs text-slate-600">
                {r.is_maatwerk ? (
                  <>
                    <span className="text-orange-600 font-medium">Op maat</span> · {r.maat_cm}
                    {r.totaal_stuks != null && r.totaal_stuks > 1 && (
                      <span className="ml-1 text-slate-400">
                        ({r.pickbaar_stuks}/{r.totaal_stuks} stuks)
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-blue-600 font-medium">Standaard</span> · {r.orderaantal} stuk(s)
                  </>
                )}
              </td>
              <td className="py-2 px-3 text-xs">
                {r.is_pickbaar ? (
                  <span className="text-emerald-600">Klaar om te picken</span>
                ) : r.wacht_op ? (
                  <span className="text-amber-600">{WACHT_OP_LABEL[r.wacht_op]}</span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="py-2 px-3">
                {r.is_pickbaar || r.fysieke_locatie ? (
                  <LocatieEdit regel={r} />
                ) : (
                  <span className="text-slate-300 text-xs">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
