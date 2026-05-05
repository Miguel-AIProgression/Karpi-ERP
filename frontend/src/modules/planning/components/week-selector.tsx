// frontend/src/components/confectie/week-selector.tsx
import { cn } from '@/lib/utils/cn'

export type HorizonWeken = 1 | 2 | 4 | 8

export const HORIZON_OPTIES: Array<{ waarde: HorizonWeken; label: string }> = [
  { waarde: 1, label: 'Deze week' },
  { waarde: 2, label: '2 weken' },
  { waarde: 4, label: '4 weken' },
  { waarde: 8, label: '8 weken' },
]

export function WeekSelector({
  waarde,
  onChange,
}: {
  waarde: HorizonWeken
  onChange: (w: HorizonWeken) => void
}) {
  return (
    <div className="inline-flex rounded-[var(--radius)] border border-slate-200 bg-white p-0.5">
      {HORIZON_OPTIES.map((o) => {
        const active = o.waarde === waarde
        return (
          <button
            key={o.waarde}
            onClick={() => onChange(o.waarde)}
            className={cn(
              'px-3 py-1.5 text-xs rounded transition-colors',
              active
                ? 'bg-terracotta-50 text-terracotta-700 font-medium'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
