import { useState } from 'react'
import { Check } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { updateRegelEta } from '../queries/leveranciers'
import { isoWeekJaarVanIso } from '@/lib/utils/iso-week'

interface Props {
  regelId: number
  leverancierId: number | null
  verwachtDatum: string | null
  onSaved: () => void
  bijgewerktDoor?: 'karpi' | 'leverancier' | null
  bijgewerktOp?: string | null
  leverancierNaam?: string | null
}

function isoWeekLabel(iso: string | null): string {
  const w = isoWeekJaarVanIso(iso)
  return w ? `wk ${w.week}` : ''
}

function formatDatumKort(iso: string | null): string {
  if (!iso) return ''
  return `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`
}

/** Inline ETA-editor voor inkooporder_regels.verwacht_datum (mig 318/319: update_regel_eta
 * propageert dit zelf naar orders.afleverdatum en de leverancier-portal — geen losse sync nodig). */
export function EtaEditCell({
  regelId,
  leverancierId,
  verwachtDatum,
  onSaved,
  bijgewerktDoor,
  bijgewerktOp,
  leverancierNaam,
}: Props) {
  const [value, setValue] = useState(verwachtDatum ?? '')
  const today = new Date().toISOString().slice(0, 10)
  const isDirty = value !== (verwachtDatum ?? '')

  const mutation = useMutation({
    mutationFn: () => updateRegelEta(regelId, value, leverancierId, null),
    onSuccess: onSaved,
  })

  const isAchterstallig = value !== '' && value < today
  const isDezeWeek = (() => {
    if (!value) return false
    const d = new Date(value)
    const now = new Date()
    const start = new Date(now)
    start.setDate(now.getDate() - now.getDay() + 1)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    return d >= start && d <= end
  })()

  return (
    <div className="flex flex-col gap-1">
      <input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={`text-sm border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-slate-400 w-[140px] tabular-nums font-medium
          ${isAchterstallig ? 'text-red-600 border-red-200' : isDezeWeek ? 'text-emerald-700 border-emerald-200' : 'text-slate-700 border-slate-200'}
          ${isDirty ? 'bg-amber-50 border-amber-300' : 'bg-transparent'}`}
      />
      <div className="text-xs text-slate-400 pl-0.5">
        <span>{isoWeekLabel(value || null)}</span>
      </div>
      {!isDirty && bijgewerktOp && (
        <div className="text-xs pl-0.5">
          <span className={bijgewerktDoor === 'leverancier' ? 'text-blue-500 font-medium' : 'text-slate-400'}>
            {bijgewerktDoor === 'leverancier' ? (leverancierNaam ?? 'Leverancier') : 'Karpi'}
          </span>
          <span className="text-slate-300"> · {formatDatumKort(bijgewerktOp.slice(0, 10))}</span>
        </div>
      )}
      {isDirty && (
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !value}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-slate-900 text-white rounded hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap w-fit"
        >
          {mutation.isPending ? (
            <span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin inline-block" />
          ) : (
            <Check size={11} />
          )}
          Opslaan
        </button>
      )}
      {mutation.isError && <span className="text-xs text-red-500">Fout bij opslaan</span>}
    </div>
  )
}
