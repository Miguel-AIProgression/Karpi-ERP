import { AlertTriangle, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { AANDACHT_STATUSES } from '@/lib/orders/order-status-groepen'
import type { StatusCount } from '@/lib/supabase/queries/orders'

interface VereistActieKaartProps {
  counts: StatusCount[]
  selected: string
  onSelect: (status: string) => void
}

/** Meldingen-blok: alle status-overstijgende aandacht-vlaggen met openstaande
 *  items, als klikbare regels. Filtert de orderlijst op klik. Verdwijnt volledig
 *  als er niets openstaat. */
export function VereistActieKaart({ counts, selected, onSelect }: VereistActieKaartProps) {
  const countMap = new Map(counts.map((c) => [c.status, c.aantal]))
  const items = AANDACHT_STATUSES.map((status) => ({
    status,
    count: countMap.get(status) ?? 0,
  })).filter((i) => i.count > 0)

  if (items.length === 0) return null

  return (
    <div className="mb-4 rounded-[var(--radius-sm)] border border-amber-200 bg-amber-50/60 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-amber-200/70">
        <AlertTriangle size={15} className="text-amber-600" />
        <span className="text-sm font-semibold text-amber-800">Vereist actie</span>
      </div>
      <div className="divide-y divide-amber-100">
        {items.map(({ status, count }) => (
          <button
            key={status}
            type="button"
            onClick={() => onSelect(status)}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-amber-100/60',
              selected === status && 'bg-amber-100',
            )}
          >
            <span className="w-12 text-right text-base font-semibold text-amber-900 tabular-nums">
              {count}
            </span>
            <span className="flex-1 text-sm text-slate-700">{status}</span>
            <ChevronRight size={16} className="text-amber-500" />
          </button>
        ))}
      </div>
    </div>
  )
}
