import { AlertTriangle, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { AANDACHT_STATUSES } from '@/lib/orders/order-status-groepen'
import type { StatusCount } from '@/lib/supabase/queries/orders'

// Urgente vlaggen springen rood uit de kaart — hier moet meteen iets gebeuren
// (Manco = niet-gevonden colli die de binnendienst direct moet oplossen).
const URGENT_STATUSSEN = new Set<string>(['Manco'])

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
        {items.map(({ status, count }) => {
          const urgent = URGENT_STATUSSEN.has(status)
          return (
            <button
              key={status}
              type="button"
              onClick={() => onSelect(status)}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors border-l-4',
                urgent
                  ? 'border-red-500 bg-red-50/70 hover:bg-red-100/70'
                  : 'border-transparent hover:bg-amber-100/60',
                selected === status && (urgent ? 'bg-red-100' : 'bg-amber-100'),
              )}
            >
              <span
                className={cn(
                  'w-12 text-right tabular-nums font-semibold',
                  urgent ? 'text-lg text-red-700' : 'text-base text-amber-900',
                )}
              >
                {count}
              </span>
              <span
                className={cn(
                  'flex-1 text-sm',
                  urgent ? 'font-semibold text-red-800' : 'text-slate-700',
                )}
              >
                {status}
                {urgent && (
                  <span className="ml-2 text-xs font-medium text-red-600">· direct oppakken</span>
                )}
              </span>
              <ChevronRight size={16} className={urgent ? 'text-red-500' : 'text-amber-500'} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
