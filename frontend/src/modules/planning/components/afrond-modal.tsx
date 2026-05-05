import { useEffect, useState } from 'react'
import { X, CheckCircle2, Package } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useAfrondConfectie } from '@/hooks/use-confectie-planning'
import type { ConfectiePlanningRow } from '@/lib/supabase/queries/confectie-planning'

interface Props {
  stuk: ConfectiePlanningRow
  onClose: () => void
}

export function AfrondModal({ stuk, onClose }: Props) {
  const [afgerond, setAfgerond] = useState(!!stuk.confectie_afgerond_op)
  const [ingepakt, setIngepakt] = useState(!!stuk.ingepakt_op)
  const [locatie, setLocatie] = useState(stuk.locatie ?? '')
  const mutation = useAfrondConfectie()

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Ingepakt impliceert afgerond
  const effAfgerond = afgerond || ingepakt

  async function opslaan() {
    await mutation.mutateAsync({
      snijplan_id: stuk.confectie_id,
      afgerond: effAfgerond,
      ingepakt,
      locatie,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white rounded-[var(--radius)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Confectie afronden</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {stuk.lengte_cm}×{stuk.breedte_cm} cm · {stuk.klant_naam}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="text-xs text-slate-500 space-y-0.5">
            <div><span className="font-medium text-slate-700">Order:</span> {stuk.order_nr}</div>
            <div><span className="font-medium text-slate-700">Confectie-nr:</span> {stuk.confectie_nr}</div>
            <div><span className="font-medium text-slate-700">Type:</span> <span className="capitalize">{stuk.type_bewerking}</span>
              {stuk.maatwerk_band_kleur && <span className="text-slate-400"> · band {stuk.maatwerk_band_kleur}</span>}
            </div>
            {stuk.maatwerk_instructies && (
              <div className="pt-1"><span className="font-medium text-slate-700">Instructies:</span> {stuk.maatwerk_instructies}</div>
            )}
          </div>

          <label className="flex items-start gap-3 p-3 rounded-[var(--radius-sm)] border border-slate-200 cursor-pointer hover:bg-slate-50">
            <input
              type="checkbox"
              checked={effAfgerond}
              onChange={(e) => {
                setAfgerond(e.target.checked)
                if (!e.target.checked) setIngepakt(false)
              }}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                <CheckCircle2 size={15} className="text-emerald-600" /> Afgerond
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Confectiewerk is voltooid.</p>
            </div>
          </label>

          <label className={cn(
            'flex items-start gap-3 p-3 rounded-[var(--radius-sm)] border cursor-pointer',
            !effAfgerond ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed' : 'border-slate-200 hover:bg-slate-50',
          )}>
            <input
              type="checkbox"
              checked={ingepakt}
              disabled={!effAfgerond}
              onChange={(e) => setIngepakt(e.target.checked)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                <Package size={15} className="text-terracotta-600" /> Ingepakt
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Klaar voor verzending — stuk verdwijnt uit de planning (status <span className="font-medium">Gereed</span>).</p>
            </div>
          </label>

          <div>
            <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1">Locatie</label>
            <input
              type="text"
              value={locatie}
              onChange={(e) => setLocatie(e.target.value)}
              placeholder="Bijv. Rek A-12"
              className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
            />
            <p className="text-[11px] text-slate-400 mt-1">Waar ligt het stuk fysiek in het magazijn?</p>
          </div>

          {mutation.isError && (
            <div className="p-2 rounded-[var(--radius-sm)] bg-red-50 text-red-700 text-xs">
              Fout: {(mutation.error as Error).message}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-[var(--radius-sm)] text-sm text-slate-600 hover:bg-slate-100"
          >
            Annuleren
          </button>
          <button
            onClick={opslaan}
            disabled={mutation.isPending}
            className="px-4 py-1.5 rounded-[var(--radius-sm)] bg-terracotta-500 text-white text-sm font-medium hover:bg-terracotta-600 transition-colors disabled:opacity-50"
          >
            {mutation.isPending ? 'Opslaan...' : 'Opslaan'}
          </button>
        </div>
      </div>
    </div>
  )
}
