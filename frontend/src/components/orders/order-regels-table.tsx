import { Link } from 'react-router-dom'
import { Scissors } from 'lucide-react'
import { formatCurrency } from '@/lib/utils/formatters'
import { SNIJPLAN_STATUS_COLORS, AFWERKING_MAP } from '@/lib/utils/constants'
import { getVormDisplay } from '@/lib/utils/vorm-labels'
import type { OrderRegel } from '@/lib/supabase/queries/orders'

function formatMaat(regel: OrderRegel): string {
  const l = regel.maatwerk_lengte_cm
  const b = regel.maatwerk_breedte_cm
  if (!l || !b) return ''
  return `${l}×${b} cm`
}

function SnijplanStatusBadge({ status }: { status: string }) {
  const colors = SNIJPLAN_STATUS_COLORS[status] ?? { bg: 'bg-slate-100', text: 'text-slate-600' }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}>
      {status}
    </span>
  )
}

function RegelRow({ regel }: { regel: OrderRegel }) {
  const afwerkingInfo = regel.maatwerk_afwerking ? AFWERKING_MAP[regel.maatwerk_afwerking] : null
  const maat = formatMaat(regel)

  return (
    <>
      <tr className={`${regel.is_maatwerk ? 'border-b-0' : 'border-b border-slate-50'} hover:bg-slate-50`}>
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
          {regel.omschrijving_2 && !regel.is_maatwerk && (
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
      {regel.is_maatwerk && (
        <tr className="border-b border-slate-50 bg-purple-50/30">
          <td colSpan={9} className="px-4 py-2">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1 text-purple-600 font-medium">
                <Scissors size={12} />
                Maatwerk
              </span>
              {maat ? (
                <span className="text-slate-600 font-medium">{maat}</span>
              ) : regel.omschrijving_2 ? (
                <span className="text-slate-600">{regel.omschrijving_2}</span>
              ) : null}
              {regel.maatwerk_vorm && (
                <span className="text-xs text-purple-600">{getVormDisplay(regel.maatwerk_vorm).label}</span>
              )}
              {afwerkingInfo && (
                <span className={`px-1.5 py-0.5 rounded text-xs ${afwerkingInfo.bg} ${afwerkingInfo.text}`}>
                  {afwerkingInfo.code} — {afwerkingInfo.label}
                </span>
              )}
              {regel.maatwerk_band_kleur && (
                <span className="text-slate-500">Band: {regel.maatwerk_band_kleur}</span>
              )}
              {regel.maatwerk_instructies && (
                <span className="text-slate-500 italic">{regel.maatwerk_instructies}</span>
              )}

              {/* Productie status */}
              {regel.snijplannen && regel.snijplannen.length > 0 && (
                <span className="ml-auto flex items-center gap-2">
                  {regel.snijplannen.map((sp) => (
                    <Link
                      key={sp.id}
                      to="/productie/snijplanning"
                      className="inline-flex items-center gap-1.5 hover:opacity-80"
                      title={`Snijplan ${sp.snijplan_nr}`}
                    >
                      <SnijplanStatusBadge status={sp.status} />
                    </Link>
                  ))}
                </span>
              )}
              {regel.is_maatwerk && (!regel.snijplannen || regel.snijplannen.length === 0) && (
                <span className="ml-auto text-slate-400 text-xs">Geen snijplan</span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

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
              <RegelRow key={regel.id} regel={regel} />
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
