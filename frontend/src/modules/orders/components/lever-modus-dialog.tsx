import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import type { LeverModus } from '@/lib/supabase/queries/reserveringen'

export interface LeverModusTekort {
  regelnummer: number
  artikelnr?: string | null
  aantal_tekort: number
  verwachte_leverweek?: string | null
}

interface Props {
  open: boolean
  tekorten: LeverModusTekort[]
  defaultModus: LeverModus
  onConfirm: (modus: LeverModus) => void
  onCancel: () => void
}

export function LeverModusDialog({ open, tekorten, defaultModus, onConfirm, onCancel }: Props) {
  const [modus, setModus] = useState<LeverModus>(defaultModus)

  if (!open) return null

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onConfirm(modus)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-md">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="font-medium text-lg">Order heeft regels die wachten op inkoop</h2>
            <p className="text-sm text-slate-500">Kies hoe je deze order wilt leveren</p>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-700" aria-label="Sluiten">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-3 text-sm">
          <div className="text-slate-700">
            {tekorten.length} regel{tekorten.length === 1 ? '' : 's'} hebben (deels) wachten op inkoop:
          </div>
          <ul className="border border-slate-200 rounded p-2 bg-slate-50 text-xs space-y-1 max-h-40 overflow-auto">
            {tekorten.map(t => (
              <li key={t.regelnummer}>
                Regel {t.regelnummer}: {t.aantal_tekort}× wacht
                {t.verwachte_leverweek && <> (lever {t.verwachte_leverweek})</>}
                {t.artikelnr && <span className="text-slate-500"> — {t.artikelnr}</span>}
              </li>
            ))}
          </ul>

          <div className="pt-2 font-medium text-slate-800">Hoe leveren?</div>
          <label className="flex items-start gap-2 py-1 cursor-pointer">
            <input
              type="radio"
              name="lever_modus"
              value="deelleveringen"
              checked={modus === 'deelleveringen'}
              onChange={() => setModus('deelleveringen')}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">Deelleveringen</span>
              <span className="block text-xs text-slate-500">
                Stuur direct wat klaar is, rest komt later (mogelijk meerdere zendingen).
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 py-1 cursor-pointer">
            <input
              type="radio"
              name="lever_modus"
              value="in_een_keer"
              checked={modus === 'in_een_keer'}
              onChange={() => setModus('in_een_keer')}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">In één keer</span>
              <span className="block text-xs text-slate-500">
                Wacht tot alles binnen is — één zending op de laatste leverweek.
              </span>
            </span>
          </label>

          <footer className="flex justify-end gap-2 pt-3 border-t border-slate-200 -mx-6 px-6">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm rounded border border-slate-300 hover:bg-slate-50"
            >
              Annuleren
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm rounded bg-slate-900 text-white hover:bg-slate-800"
            >
              Bevestigen
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
