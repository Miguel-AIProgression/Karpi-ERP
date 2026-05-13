import { Link } from 'react-router-dom'
import { useInkooporders } from '../hooks/use-inkooporders'
import { InkooporderStatusBadge } from './inkooporder-status-badge'

interface Props {
  leverancierId: number
}

function formatDatum(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatMeters(value: number): string {
  return value.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
}

/**
 * Card met openstaande inkooporders voor één leverancier.
 *
 * Extract uit `leverancier-detail.tsx`: deze card hoort bij de Inkoop-Module
 * omdat hij Inkoop-data (orders + status) visualiseert; door 'm hier neer te
 * zetten kan de leveranciers-page in een latere stap volledig dom blijven en
 * via `<LeverancierStatsCard leverancierId={...} />` op het scherm worden gezet.
 */
export function LeverancierStatsCard({ leverancierId }: Props) {
  const { data: orders = [] } = useInkooporders({
    leverancier_id: leverancierId,
    alleen_open: true,
  })

  return (
    <section className="bg-white rounded-[var(--radius)] border border-slate-200 p-5">
      <h2 className="font-medium mb-4">Openstaande inkooporders ({orders.length})</h2>
      {orders.length === 0 ? (
        <p className="text-sm text-slate-400">Geen openstaande orders</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left pb-2 font-medium">Ordernr</th>
              <th className="text-left pb-2 font-medium">Leverweek</th>
              <th className="text-right pb-2 font-medium">Openstaand</th>
              <th className="text-left pb-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((o) => (
              <tr key={o.id}>
                <td className="py-2">
                  <Link
                    to={`/inkoop/${o.id}`}
                    className="text-terracotta-600 hover:text-terracotta-700"
                  >
                    {o.inkooporder_nr}
                  </Link>
                  {o.oud_inkooporder_nr && (
                    <span className="ml-2 text-xs text-slate-400">
                      ({o.oud_inkooporder_nr})
                    </span>
                  )}
                </td>
                <td className="py-2 text-slate-600">
                  {o.leverweek ?? formatDatum(o.verwacht_datum)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatMeters(o.totaal_te_leveren_m)}
                </td>
                <td className="py-2">
                  <InkooporderStatusBadge status={o.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
