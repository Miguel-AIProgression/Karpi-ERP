import { Link } from 'react-router-dom'
import { useFacturen } from '@/hooks/use-facturen'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency, formatDate } from '@/lib/utils/formatters'
import type { FactuurListItem } from '@/lib/supabase/queries/facturen'

interface FactuurLijstProps {
  debiteurNr?: number
  compact?: boolean
  /** client-side filter — applied on top of the debiteurNr filter */
  items?: FactuurListItem[]
}

export function FactuurLijst({ debiteurNr, compact = false, items }: FactuurLijstProps) {
  const { data, isLoading } = useFacturen(debiteurNr)

  if (isLoading) {
    return <p className="text-sm text-slate-400 py-6 text-center">Laden…</p>
  }

  const facturen = items ?? data ?? []

  if (facturen.length === 0) {
    return <p className="text-sm text-slate-400 py-6 text-center">Geen facturen</p>
  }

  const showKlant = !debiteurNr

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <th className="pb-3 pr-4 font-medium text-slate-500">Factuurnr</th>
            <th className="pb-3 pr-4 font-medium text-slate-500">Datum</th>
            {showKlant && (
              <th className="pb-3 pr-4 font-medium text-slate-500">Klant</th>
            )}
            <th className="pb-3 pr-4 font-medium text-slate-500">Status</th>
            <th className="pb-3 pr-4 font-medium text-slate-500 text-right">Totaal</th>
            <th className="pb-3 font-medium text-slate-500"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {facturen.map((f) => (
            <tr key={f.id} className="hover:bg-slate-50 transition-colors">
              <td className={`py-3 pr-4 font-mono text-xs text-slate-700 ${compact ? '' : 'py-3'}`}>
                {f.factuur_nr}
              </td>
              <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">
                {formatDate(f.factuurdatum)}
              </td>
              {showKlant && (
                <td className="py-3 pr-4 text-slate-700 max-w-[200px] truncate">
                  {f.klant_naam ?? '—'}
                </td>
              )}
              <td className="py-3 pr-4">
                <StatusBadge status={f.status} type="factuur" />
              </td>
              <td className="py-3 pr-4 text-right font-medium text-slate-700 whitespace-nowrap">
                {formatCurrency(f.totaal)}
              </td>
              <td className="py-3">
                <Link
                  to={`/facturatie/${f.id}`}
                  className="text-xs text-terracotta-500 hover:underline whitespace-nowrap"
                >
                  Bekijk
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
