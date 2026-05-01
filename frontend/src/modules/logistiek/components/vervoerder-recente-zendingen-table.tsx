import { Link } from 'react-router-dom'
import { ZendingStatusBadge } from '@/modules/logistiek/components/zending-status-badge'
import type { RecenteZending } from '@/modules/logistiek/queries/vervoerders'

interface VervoerderRecenteZendingenTableProps {
  zendingen: RecenteZending[]
}

/**
 * Compacte tabel met de laatste N zendingen via een vervoerder.
 * Gebruikt op de vervoerder-detail-pagina.
 */
export function VervoerderRecenteZendingenTable({
  zendingen,
}: VervoerderRecenteZendingenTableProps) {
  if (zendingen.length === 0) {
    return (
      <div className="text-sm text-slate-400">
        Nog geen zendingen via deze vervoerder.
      </div>
    )
  }

  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-slate-500 uppercase tracking-wider">
        <tr>
          <th className="px-3 py-2 text-left font-medium">Zending</th>
          <th className="px-3 py-2 text-left font-medium">Klant</th>
          <th className="px-3 py-2 text-left font-medium">Status</th>
          <th className="px-3 py-2 text-left font-medium">Track &amp; Trace</th>
          <th className="px-3 py-2 text-left font-medium">Datum</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {zendingen.map((z) => (
          <tr key={z.id}>
            <td className="px-3 py-2">
              <Link
                to={`/logistiek/${z.zending_nr}`}
                className="text-terracotta-600 hover:underline font-medium"
              >
                {z.zending_nr}
              </Link>
            </td>
            <td className="px-3 py-2 text-slate-700">
              {z.klant_naam ?? <span className="text-slate-400">—</span>}
            </td>
            <td className="px-3 py-2">
              <ZendingStatusBadge status={z.status} />
            </td>
            <td className="px-3 py-2 font-mono text-xs text-slate-500">
              {z.track_trace ?? <span className="text-slate-400">—</span>}
            </td>
            <td className="px-3 py-2 text-slate-500">
              {z.verzenddatum ?? new Date(z.created_at).toLocaleDateString('nl-NL')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
