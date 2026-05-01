import type { MaatwerkVormRow } from '@/lib/supabase/queries/op-maat'
import { VORM_ICONS } from '@/lib/icons/vormen'
import { formatCurrency } from '@/lib/utils/formatters'

interface VormTegelProps {
  vorm: MaatwerkVormRow
  selected: boolean
  onClick: () => void
}

export function VormTegel({ vorm, selected, onClick }: VormTegelProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={[
        'flex flex-col items-center gap-1.5 p-3 rounded-[var(--radius-sm)] border text-center transition-colors',
        selected
          ? 'border-purple-500 bg-purple-50 text-purple-900'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
      ].join(' ')}
    >
      <div className="w-12 h-9 text-current">
        {VORM_ICONS[vorm.code] ?? VORM_ICONS.rechthoek}
      </div>
      <div className="text-xs font-medium">{vorm.naam}</div>
      {vorm.toeslag > 0 && (
        <div className="text-[10px] text-slate-500">+{formatCurrency(vorm.toeslag)}</div>
      )}
    </button>
  )
}
