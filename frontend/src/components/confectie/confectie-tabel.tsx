import { cn } from '@/lib/utils/cn'
import { CONFECTIE_STATUS_COLORS } from '@/lib/utils/constants'
import type { ConfectieRow } from '@/lib/types/productie'

interface ConfectieTabelProps {
  rows: ConfectieRow[]
  isLoading?: boolean
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`
}

function StatusBadge({ status }: { status: string }) {
  const colors = CONFECTIE_STATUS_COLORS[status] ?? { bg: 'bg-slate-100', text: 'text-slate-600' }
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', colors.bg, colors.text)}>
      {status}
    </span>
  )
}

function AfwerkingBadge({ afwerking }: { afwerking: string | null }) {
  if (!afwerking || afwerking === 'geen') return <span className="text-slate-300">—</span>

  const colorMap: Record<string, { bg: string; text: string }> = {
    overlocked: { bg: 'bg-blue-100', text: 'text-blue-700' },
    band: { bg: 'bg-purple-100', text: 'text-purple-700' },
    blindzoom: { bg: 'bg-amber-100', text: 'text-amber-700' },
  }
  const colors = colorMap[afwerking] ?? { bg: 'bg-slate-100', text: 'text-slate-600' }

  return (
    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', colors.bg, colors.text)}>
      {afwerking}
    </span>
  )
}

export function ConfectieTabel({ rows, isLoading }: ConfectieTabelProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
        Confectie orders laden...
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
        Geen confectie orders gevonden
      </div>
    )
  }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs uppercase tracking-wide">Sticker</th>
            <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs uppercase tracking-wide">Kwaliteit</th>
            <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs uppercase tracking-wide">Kleur</th>
            <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs uppercase tracking-wide">Maat (cm)</th>
            <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs uppercase tracking-wide">Afwerking</th>
            <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs uppercase tracking-wide">Klant</th>
            <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs uppercase tracking-wide">Gesneden</th>
            <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs uppercase tracking-wide">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
            >
              <td className="px-3 py-2">
                <span className="font-mono text-xs text-terracotta-600 font-medium">
                  {row.scancode}
                </span>
                <span className="block text-xs text-slate-400">{row.confectie_nr}</span>
              </td>
              <td className="px-3 py-2 font-medium text-slate-900">
                {row.kwaliteit_code}
              </td>
              <td className="px-3 py-2 text-slate-600">
                {row.kleur_code}
              </td>
              <td className="px-3 py-2 text-slate-600">
                {row.maatwerk_lengte_cm && row.maatwerk_breedte_cm
                  ? `${row.maatwerk_lengte_cm}x${row.maatwerk_breedte_cm}`
                  : '—'}
              </td>
              <td className="px-3 py-2">
                <AfwerkingBadge afwerking={row.maatwerk_afwerking} />
              </td>
              <td className="px-3 py-2">
                <span className="text-slate-900">{row.klant_naam}</span>
                <span className="block text-xs text-slate-400">{row.order_nr}</span>
              </td>
              <td className="px-3 py-2 text-slate-500 text-xs">
                {formatDateTime(row.gesneden_datum)}
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
