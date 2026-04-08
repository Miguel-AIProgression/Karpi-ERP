import { Printer } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { SnijStuk } from '@/lib/types/productie'

interface SnijstukkenTabelProps {
  stukken: SnijStuk[]
  compact?: boolean
}

export function SnijstukkenTabel({ stukken, compact }: SnijstukkenTabelProps) {
  if (stukken.length === 0) {
    return (
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6 text-center text-slate-400 text-sm">
        Geen snijstukken ingedeeld
      </div>
    )
  }

  return (
    <div className={cn(
      'bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden',
      compact ? '' : 'mb-6'
    )}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50">
            <th className="w-8 px-3 py-2">
              <input type="checkbox" className="rounded border-slate-300" />
            </th>
            <th className="w-8 px-2 py-2" />
            <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs uppercase tracking-wide">Maat</th>
            <th className="text-right px-3 py-2 font-medium text-slate-600 text-xs uppercase tracking-wide">Aantal</th>
            <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs uppercase tracking-wide">Klant</th>
            <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs uppercase tracking-wide">Bron</th>
            <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs uppercase tracking-wide">Afwerking</th>
            {!compact && (
              <th className="text-left px-3 py-2 font-medium text-slate-600 text-xs uppercase tracking-wide">Opmerking</th>
            )}
          </tr>
        </thead>
        <tbody>
          {stukken.map((stuk, i) => (
            <tr
              key={stuk.snijplan_id ?? `${stuk.order_regel_id}-${i}`}
              className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
            >
              <td className="px-3 py-2">
                <input type="checkbox" className="rounded border-slate-300" />
              </td>
              <td className="px-2 py-2">
                <button className="text-slate-400 hover:text-slate-600">
                  <Printer size={14} />
                </button>
              </td>
              <td className="px-3 py-2 font-medium text-slate-900">
                {stuk.lengte_cm}x{stuk.breedte_cm}
              </td>
              <td className="px-3 py-2 text-right text-slate-600">1</td>
              <td className="px-3 py-2">
                <span className="text-slate-900">{stuk.klant_naam}</span>
                <span className="block text-xs text-slate-400">{stuk.order_nr}</span>
              </td>
              <td className="px-3 py-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {stuk.vorm === 'rechthoek' ? 'RECHT' : stuk.vorm.toUpperCase()}
                </span>
              </td>
              <td className="px-3 py-2">
                {stuk.afwerking && stuk.afwerking !== 'geen' ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                    {stuk.afwerking}
                  </span>
                ) : (
                  <span className="text-slate-300">—</span>
                )}
              </td>
              {!compact && (
                <td className="px-3 py-2 text-slate-500 text-xs max-w-32 truncate">
                  —
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
