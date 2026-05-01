import type { MaatwerkVormMaat } from '@/lib/supabase/queries/op-maat'

interface VormMaatChipProps {
  maat: MaatwerkVormMaat
  active: boolean
  onClick: () => void
}

export function VormMaatChip({ maat, active, onClick }: VormMaatChipProps) {
  const label = maat.diameter_cm
    ? `Ø ${maat.diameter_cm} cm`
    : `${maat.lengte_cm} × ${maat.breedte_cm} cm`

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'px-3 py-1.5 text-xs rounded-full border transition-colors',
        active
          ? 'bg-purple-600 text-white border-purple-600'
          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300',
      ].join(' ')}
    >
      {label}
    </button>
  )
}
