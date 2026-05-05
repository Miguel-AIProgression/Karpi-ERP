import { cn } from '@/lib/utils/cn'
import type { StatusCount } from '@/lib/supabase/queries/orders'

const ALL_STATUSES = [
  'Alle',
  'Nieuw',
  'Actie vereist',
  'Wacht op picken',
  'Wacht op voorraad',
  'In snijplan',
  'In productie',
  'Deels gereed',
  'Klaar voor verzending',
  'Verzonden',
  'Geannuleerd',
]

interface StatusTabsProps {
  selected: string
  onSelect: (status: string) => void
  counts: StatusCount[]
}

export function StatusTabs({ selected, onSelect, counts }: StatusTabsProps) {
  const countMap = new Map(counts.map((c) => [c.status, c.aantal]))
  const allCount = counts.reduce((sum, c) => sum + c.aantal, 0)

  return (
    <div className="flex gap-1 overflow-x-auto pb-2 mb-4">
      {ALL_STATUSES.map((status) => {
        const count = status === 'Alle' ? allCount : (countMap.get(status) ?? 0)
        const isActive = selected === status

        return (
          <button
            key={status}
            onClick={() => onSelect(status)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors',
              isActive
                ? 'bg-terracotta-500 text-white font-medium'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            )}
          >
            {status}
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded-full',
                isActive ? 'bg-white/20' : 'bg-slate-200'
              )}
            >
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
