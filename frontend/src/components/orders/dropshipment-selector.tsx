import { DROPSHIP_KLEIN_PRIJS, DROPSHIP_GROOT_PRIJS, type DropshipmentKeuze } from '@/lib/constants/dropshipment'
import { formatCurrency } from '@/lib/utils/formatters'

interface DropshipmentSelectorProps {
  value: DropshipmentKeuze
  onChange: (keuze: DropshipmentKeuze) => void
  disabled?: boolean
}

const OPTIES: { keuze: DropshipmentKeuze; label: string; sub: string; prijs?: number }[] = [
  { keuze: 'nee',   label: 'Geen dropshipment',          sub: 'Standaard levering aan klant' },
  { keuze: 'klein', label: 'Dropshipment t/m 200 cm',    sub: 'Tapijt breedte ≤ 200 cm',     prijs: DROPSHIP_KLEIN_PRIJS },
  { keuze: 'groot', label: 'Dropshipment vanaf 200 cm',  sub: 'Tapijt breedte > 200 cm',     prijs: DROPSHIP_GROOT_PRIJS },
]

export function DropshipmentSelector({ value, onChange, disabled }: DropshipmentSelectorProps) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-medium text-slate-500 mb-2">Dropshipment</div>
      <div className="flex flex-wrap gap-2">
        {OPTIES.map((opt) => {
          const actief = value === opt.keuze
          return (
            <button
              key={opt.keuze}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.keuze)}
              className={[
                'flex items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-sm transition-colors',
                actief
                  ? 'border-terracotta-500 bg-terracotta-50 text-terracotta-700 font-medium'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
              ].join(' ')}
            >
              <span
                className={[
                  'h-3.5 w-3.5 rounded-full border-2 flex-shrink-0',
                  actief ? 'border-terracotta-500 bg-terracotta-500' : 'border-slate-300 bg-white',
                ].join(' ')}
              />
              <span>
                {opt.label}
                {opt.prijs != null && (
                  <span className={actief ? 'text-terracotta-600' : 'text-slate-400'}>
                    {' '}— {formatCurrency(opt.prijs)}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
