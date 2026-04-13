import { ConfectieBlokCard } from './confectie-blok-card'
import type { LaneBlok } from '@/lib/utils/bereken-agenda'
import type { ConfectiePlanningRow } from '@/lib/supabase/queries/confectie-planning'

interface Props {
  typeBewerking: string
  blokken: LaneBlok<ConfectiePlanningRow>[]
  onSelect?: (row: ConfectiePlanningRow) => void
}

export function LaneKolom({ typeBewerking, blokken, onSelect }: Props) {
  const totMin = blokken.reduce((s, b) => s + b.duurMinuten, 0)
  const uren = Math.floor(totMin / 60)
  const min = Math.round(totMin % 60)

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden flex flex-col">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-800 capitalize">{typeBewerking}</span>
          <span className="text-xs text-slate-500 tabular-nums">
            {blokken.length} stuks · {uren > 0 ? `${uren}u ` : ''}{min}m
          </span>
        </div>
      </div>
      <div className="p-3 space-y-2 flex-1">
        {blokken.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4">Geen stuks gepland</p>
        ) : (
          blokken.map((b) => (
            <ConfectieBlokCard key={b.item.confectie_id} blok={b} onClick={onSelect ? () => onSelect(b.item) : undefined} />
          ))
        )}
      </div>
    </div>
  )
}
