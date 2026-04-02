import { formatCurrency } from '@/lib/utils/formatters'
import type { VertegMaandomzet } from '@/lib/supabase/queries/vertegenwoordigers'

const MAAND_NAMEN = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']

interface Props {
  data: VertegMaandomzet[]
  isLoading: boolean
}

export function OmzetTrend({ data, isLoading }: Props) {
  if (isLoading) return <div className="p-5 text-sm text-slate-400">Laden...</div>

  if (!data || data.length === 0) {
    return <div className="p-5 text-sm text-slate-400">Geen omzet data</div>
  }

  const maxOmzet = Math.max(...data.map((d) => d.omzet), 1)

  return (
    <div className="space-y-1.5">
      {data.map((d) => {
        const pct = (d.omzet / maxOmzet) * 100
        return (
          <div key={d.maand} className="flex items-center gap-3 text-sm">
            <span className="w-8 text-xs text-slate-400 text-right shrink-0">
              {MAAND_NAMEN[d.maand - 1]}
            </span>
            <div className="flex-1 h-5 bg-slate-50 rounded-sm overflow-hidden">
              {d.omzet > 0 && (
                <div
                  className="h-full bg-terracotta-400 rounded-sm transition-all"
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              )}
            </div>
            <span className="w-24 text-xs text-right text-slate-600 shrink-0 tabular-nums">
              {formatCurrency(d.omzet)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
