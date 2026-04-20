import { cn } from '@/lib/utils/cn'

export interface CapaciteitBalkProps {
  nodigMin: number
  beschikbaarMin: number
  label: string
}

export function CapaciteitBalk({ nodigMin, beschikbaarMin, label }: CapaciteitBalkProps) {
  const pct = beschikbaarMin > 0 ? (nodigMin / beschikbaarMin) * 100 : 0
  const overload = pct > 100
  const druk = pct >= 80 && pct <= 100
  const kleur = overload ? 'bg-red-500' : druk ? 'bg-amber-500' : 'bg-emerald-500'
  const weergavePct = Math.round(pct)
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-slate-500 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={cn('h-full transition-all', kleur)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className={cn('w-12 text-right tabular-nums', overload && 'text-red-600 font-medium')}>
        {weergavePct}%
      </span>
    </div>
  )
}
