import { useState } from 'react'
import { AlertTriangle, ChevronRight, ChevronDown } from 'lucide-react'
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

/** Inklapbaar meldingen-blok: alle status-overstijgende aandacht-vlaggen met
 *  openstaande items, als klikbare regels. De kaart kleurt rood zodra er een
 *  urgente vlag (Manco) bij zit, anders amber, en verdwijnt volledig zodra alles
 *  is weggewerkt. */
export function VereistActieKaart({ counts, selected, onSelect }: VereistActieKaartProps) {
  const [open, setOpen] = useState(true)
  const countMap = new Map(counts.map((c) => [c.status, c.aantal]))
  const items = AANDACHT_STATUSES.map((status) => ({
    status,
    count: countMap.get(status) ?? 0,
  })).filter((i) => i.count > 0)

  if (items.length === 0) return null

  const urgent = items.some((i) => URGENT_STATUSSEN.has(i.status))

  return (
    <div
      className={cn(
        'mb-4 rounded-[var(--radius-sm)] border overflow-hidden',
        urgent ? 'border-red-300' : 'border-amber-200',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center gap-2 px-4 py-2 text-left transition-colors',
          urgent ? 'bg-red-50/70 hover:bg-red-100/60' : 'bg-amber-50/60 hover:bg-amber-100/50',
          open && (urgent ? 'border-b border-red-200' : 'border-b border-amber-200/70'),
        )}
      >
        <AlertTriangle size={15} className={urgent ? 'text-red-600' : 'text-amber-600'} />
        <span className={cn('text-sm font-semibold', urgent ? 'text-red-800' : 'text-amber-800')}>
          Vereist actie
        </span>
        {!open && urgent && (
          <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
            {countMap.get('Manco') ?? 0} Manco
          </span>
        )}
        <ChevronDown
          size={16}
          className={cn(
            'ml-auto transition-transform',
            open ? '' : '-rotate-90',
            urgent ? 'text-red-500' : 'text-amber-600',
          )}
        />
      </button>

      {open && (
        <div className="divide-y divide-amber-100">
          {items.map(({ status, count }) => {
            const isUrgent = URGENT_STATUSSEN.has(status)
            return (
              <button
                key={status}
                type="button"
                onClick={() => onSelect(status)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors border-l-4',
                  isUrgent
                    ? 'border-red-500 bg-red-50/70 hover:bg-red-100/70'
                    : 'border-transparent hover:bg-amber-100/60',
                  selected === status && (isUrgent ? 'bg-red-100' : 'bg-amber-100'),
                )}
              >
                <span
                  className={cn(
                    'w-12 text-right tabular-nums font-semibold',
                    isUrgent ? 'text-lg text-red-700' : 'text-base text-amber-900',
                  )}
                >
                  {count}
                </span>
                <span
                  className={cn(
                    'flex-1 text-sm',
                    isUrgent ? 'font-semibold text-red-800' : 'text-slate-700',
                  )}
                >
                  {status}
                </span>
                <ChevronRight size={16} className={isUrgent ? 'text-red-500' : 'text-amber-500'} />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
