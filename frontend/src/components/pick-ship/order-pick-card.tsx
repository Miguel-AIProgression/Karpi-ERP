import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { LocatieEdit } from './locatie-edit'
import { formatDate } from '@/lib/utils/formatters'
import type { PickShipOrder } from '@/lib/types/pick-ship'

interface Props {
  order: PickShipOrder
}

export function OrderPickCard({ order }: Props) {
  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      <div className="flex items-start justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div>
          <Link
            to={`/orders/${order.order_id}`}
            className="inline-flex items-center gap-1 text-terracotta-600 font-medium hover:underline"
          >
            {order.order_nr}
            <ExternalLink size={12} />
          </Link>
          <div className="text-sm text-slate-700 mt-0.5">{order.klant_naam}</div>
          {order.afl_naam && (
            <div className="text-xs text-slate-500 mt-0.5">
              → {order.afl_naam}
              {order.afl_plaats ? `, ${order.afl_plaats}` : ''}
            </div>
          )}
        </div>
        <div className="text-right text-sm">
          <div className="text-slate-700 font-medium">
            {formatDate(order.afleverdatum)}
          </div>
          <div className="text-xs text-slate-500">
            {order.aantal_regels} stuk{order.aantal_regels === 1 ? '' : 's'} · {order.totaal_m2.toFixed(2)} m²
          </div>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
            <th className="py-1.5 px-3 font-medium">Sticker</th>
            <th className="py-1.5 px-3 font-medium">Product</th>
            <th className="py-1.5 px-3 font-medium">Maat (cm)</th>
            <th className="py-1.5 px-3 font-medium text-right">m²</th>
            <th className="py-1.5 px-3 font-medium">Locatie</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {order.regels.map((r) => (
            <tr key={r.snijplan_id} className="hover:bg-slate-50">
              <td className="py-2 px-3 font-mono text-xs">{r.scancode ?? r.snijplan_nr}</td>
              <td className="py-2 px-3">
                <span className="text-slate-700">{r.product}</span>
                {r.kleur && <span className="text-slate-400 ml-1 text-xs">({r.kleur})</span>}
              </td>
              <td className="py-2 px-3 text-slate-600">{r.maat_cm}</td>
              <td className="py-2 px-3 text-right">{r.m2.toFixed(2)}</td>
              <td className="py-2 px-3">
                <LocatieEdit snijplanId={r.snijplan_id} locatie={r.locatie} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
