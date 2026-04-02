import { Link } from 'react-router-dom'
import { formatCurrency } from '@/lib/utils/formatters'
import type { OrderRegel } from '@/lib/supabase/queries/orders'

interface OrderRegelsTableProps {
  regels: OrderRegel[]
  isLoading: boolean
}

export function OrderRegelsTable({ regels, isLoading }: OrderRegelsTableProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-8 text-center text-slate-400">
        Orderregels laden...
      </div>
    )
  }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100">
        <h3 className="font-medium text-slate-900">
          Orderregels ({regels.length})
        </h3>
      </div>

      {regels.length === 0 ? (
        <div className="p-8 text-center text-slate-400">Geen orderregels</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="text-left px-4 py-2 font-medium text-slate-600">#</th>
              <th className="text-left px-4 py-2 font-medium text-slate-600">Artikel</th>
              <th className="text-left px-4 py-2 font-medium text-slate-600">Omschrijving</th>
              <th className="text-right px-4 py-2 font-medium text-slate-600">Aantal</th>
              <th className="text-right px-4 py-2 font-medium text-slate-600">Te leveren</th>
              <th className="text-right px-4 py-2 font-medium text-slate-600">Backorder</th>
              <th className="text-right px-4 py-2 font-medium text-slate-600">Prijs</th>
              <th className="text-right px-4 py-2 font-medium text-slate-600">Korting</th>
              <th className="text-right px-4 py-2 font-medium text-slate-600">Bedrag</th>
            </tr>
          </thead>
          <tbody>
            {regels.map((regel) => (
              <tr
                key={regel.id}
                className="border-b border-slate-50 hover:bg-slate-50"
              >
                <td className="px-4 py-2 text-slate-400">{regel.regelnummer}</td>
                <td className="px-4 py-2">
                  {regel.artikelnr ? (
                    <Link
                      to={`/producten/${regel.artikelnr}`}
                      className="text-terracotta-500 hover:underline font-mono text-xs"
                    >
                      {regel.artikelnr}
                    </Link>
                  ) : (
                    '—'
                  )}
                  {regel.karpi_code && (
                    <span className="block text-xs text-slate-400">{regel.karpi_code}</span>
                  )}
                  {regel.klant_artikelnr && (
                    <span className="block text-xs text-blue-500" title="Klant artikelnr">
                      {regel.klant_artikelnr}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {regel.omschrijving}
                  {regel.omschrijving_2 && (
                    <span className="block text-xs text-slate-400">{regel.omschrijving_2}</span>
                  )}
                  {regel.klant_eigen_naam && (
                    <span className="block text-xs text-blue-500" title="Klanteigen naam">
                      {regel.klant_eigen_naam}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">{regel.orderaantal}</td>
                <td className="px-4 py-2 text-right">{regel.te_leveren}</td>
                <td className="px-4 py-2 text-right">
                  {regel.backorder > 0 ? (
                    <span className="text-amber-600">{regel.backorder}</span>
                  ) : (
                    '0'
                  )}
                </td>
                <td className="px-4 py-2 text-right">{formatCurrency(regel.prijs)}</td>
                <td className="px-4 py-2 text-right">
                  {regel.korting_pct > 0 ? `${regel.korting_pct}%` : '—'}
                </td>
                <td className="px-4 py-2 text-right font-medium">
                  {formatCurrency(regel.bedrag)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-medium">
              <td colSpan={8} className="px-4 py-2 text-right text-slate-600">
                Totaal
              </td>
              <td className="px-4 py-2 text-right">
                {formatCurrency(regels.reduce((sum, r) => sum + (r.bedrag ?? 0), 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  )
}
