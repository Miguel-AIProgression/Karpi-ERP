import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useUpsertBetaalconditie } from '@/hooks/use-betaalcondities'
import type { BetaalconditieMetAantal } from '@/lib/supabase/queries/betaalcondities'

interface Props {
  conditie?: BetaalconditieMetAantal
  onClose: () => void
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

export function BetaalconditieFormDialog({ conditie, onClose }: Props) {
  const isEdit = Boolean(conditie)
  const [code, setCode] = useState(conditie?.code ?? '')
  const [naam, setNaam] = useState(conditie?.naam ?? '')
  const [dagen, setDagen] = useState<string>(
    conditie?.dagen != null ? String(conditie.dagen) : '',
  )
  const [omschrijving, setOmschrijving] = useState(conditie?.omschrijving ?? '')
  const [actief, setActief] = useState(conditie?.actief ?? true)
  const [error, setError] = useState<string | null>(null)

  const upsert = useUpsertBetaalconditie()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmedCode = code.trim()
    const trimmedNaam = naam.trim()
    if (!isEdit && !trimmedCode) {
      setError('Code is verplicht')
      return
    }
    if (!trimmedNaam) {
      setError('Naam is verplicht')
      return
    }
    let dagenNum: number | null = null
    if (dagen.trim() !== '') {
      const n = Number(dagen)
      if (Number.isNaN(n) || n < 0 || !Number.isInteger(n)) {
        setError('Dagen moet een geheel getal ≥ 0 zijn (of leeg)')
        return
      }
      dagenNum = n
    }
    try {
      await upsert.mutateAsync({
        code: trimmedCode,
        naam: trimmedNaam,
        dagen: dagenNum,
        omschrijving: omschrijving.trim() === '' ? null : omschrijving.trim(),
        actief,
      })
      onClose()
    } catch (err) {
      console.error('[BetaalconditieFormDialog]', err)
      const e = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown } | null
      const parts = [
        typeof e?.message === 'string' ? e.message : null,
        typeof e?.details === 'string' ? `details: ${e.details}` : null,
        typeof e?.hint === 'string' ? `hint: ${e.hint}` : null,
        typeof e?.code === 'string' ? `code: ${e.code}` : null,
      ].filter(Boolean)
      setError(parts.length > 0 ? parts.join(' — ') : 'Onbekende fout — zie console')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-md">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-medium text-lg">
            {isEdit ? 'Betaalconditie bewerken' : 'Nieuwe betaalconditie'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm text-slate-600 mb-1">
              Code <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={isEdit}
              placeholder="bv. 31"
              className={`${inputClasses} ${isEdit ? 'bg-slate-50 text-slate-500' : ''}`}
              required={!isEdit}
              autoFocus={!isEdit}
            />
            {!isEdit && (
              <p className="text-xs text-slate-400 mt-1">
                Korte unieke code uit het oude ERP. Wordt prefix in
                <code className="px-1 mx-0.5 bg-slate-100 rounded text-[11px]">debiteuren.betaalconditie</code>.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">
              Naam <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={naam}
              onChange={(e) => setNaam(e.target.value)}
              placeholder="bv. 30 dagen netto"
              className={inputClasses}
              required
              autoFocus={isEdit}
            />
            <p className="text-xs text-slate-400 mt-1">
              Verschijnt in de dropdown op klant-detail. Gehele tekst wordt opgeslagen als
              <code className="px-1 mx-0.5 bg-slate-100 rounded text-[11px]">{`${code || 'CODE'} - ${naam || 'Naam'}`}</code>.
            </p>
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">Betaaltermijn (dagen)</label>
            <input
              type="number"
              min="0"
              step="1"
              value={dagen}
              onChange={(e) => setDagen(e.target.value)}
              placeholder="bv. 30 — leeg = onbekend"
              className={inputClasses}
            />
            <p className="text-xs text-slate-400 mt-1">
              Wordt door de factuur-RPC gebruikt voor de vervaldatum. NULL valt terug op default (30).
            </p>
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">Omschrijving (optioneel)</label>
            <input
              type="text"
              value={omschrijving}
              onChange={(e) => setOmschrijving(e.target.value)}
              placeholder="Interne toelichting, bv. wanneer toepassen"
              className={inputClasses}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={actief}
              onChange={(e) => setActief(e.target.checked)}
              className="rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400"
            />
            Actief (zichtbaar in dropdown)
          </label>

          {error && (
            <div className="px-3 py-2 bg-rose-50 border border-rose-100 text-sm text-rose-700 rounded-[var(--radius-sm)] whitespace-pre-line">
              {error}
            </div>
          )}

          <footer className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 -mx-6 px-6 -mb-5 pb-5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
            >
              Annuleren
            </button>
            <button
              type="submit"
              disabled={upsert.isPending}
              className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 disabled:opacity-50"
            >
              {upsert.isPending ? 'Opslaan...' : isEdit ? 'Opslaan' : 'Aanmaken'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
