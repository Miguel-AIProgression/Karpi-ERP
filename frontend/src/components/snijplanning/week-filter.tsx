import { cn } from '@/lib/utils/cn'
import { CalendarDays } from 'lucide-react'

export interface WeekFilterOption {
  label: string
  weken: number | null  // null = alle (geen filter)
}

const WEEK_OPTIONS: WeekFilterOption[] = [
  { label: 'Alle', weken: null },
  { label: 'Deze week', weken: 0 },
  { label: '1 week', weken: 1 },
  { label: '2 weken', weken: 2 },
  { label: '3 weken', weken: 3 },
  { label: '4 weken', weken: 4 },
]

/** Bereken de datum voor N weken vooruit (eind van die week = zondag) */
export function berekenTotDatum(weken: number | null): string | null {
  if (weken === null) return null
  const nu = new Date()
  // Ga naar einde van huidige week (zondag) + N extra weken
  const dag = nu.getDay()  // 0=zo, 1=ma, ...
  const dagenTotZondag = dag === 0 ? 0 : 7 - dag
  const totDatum = new Date(nu)
  totDatum.setDate(nu.getDate() + dagenTotZondag + (weken * 7))
  // Format as local date (toISOString uses UTC which can shift the day)
  const y = totDatum.getFullYear()
  const m = String(totDatum.getMonth() + 1).padStart(2, '0')
  const d = String(totDatum.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

interface WeekFilterProps {
  geselecteerd: number | null
  onChange: (weken: number | null) => void
}

export function WeekFilter({ geselecteerd, onChange }: WeekFilterProps) {
  const totDatum = berekenTotDatum(geselecteerd)

  return (
    <div className="flex items-center gap-2">
      <CalendarDays size={16} className="text-slate-400" />
      <span className="text-sm text-slate-500">Levering t/m:</span>
      <div className="flex gap-1">
        {WEEK_OPTIONS.map((opt) => {
          const isActive = geselecteerd === opt.weken
          return (
            <button
              key={opt.label}
              onClick={() => onChange(opt.weken)}
              className={cn(
                'px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors',
                isActive
                  ? 'bg-blue-600 text-white font-medium'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      {totDatum && (
        <span className="text-xs text-slate-400 ml-1">
          (t/m {new Date(totDatum + 'T00:00:00').toLocaleDateString('nl-NL')})
        </span>
      )}
    </div>
  )
}
