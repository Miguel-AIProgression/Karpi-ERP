import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import {
  useCreateInkoopgroep,
  useUpdateInkoopgroep,
} from '@/hooks/use-inkoopgroepen'
import type { InkoopgroepDetail } from '@/lib/supabase/queries/inkoopgroepen'

interface Props {
  groep?: InkoopgroepDetail
  onClose: () => void
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

export function InkoopgroepFormDialog({ groep, onClose }: Props) {
  const isEdit = Boolean(groep)
  const [code, setCode] = useState(groep?.code ?? '')
  const [naam, setNaam] = useState(groep?.naam ?? '')
  const [omschrijving, setOmschrijving] = useState(groep?.omschrijving ?? '')
  const [actief, setActief] = useState(groep?.actief ?? true)
  const [error, setError] = useState<string | null>(null)

  const create = useCreateInkoopgroep()
  const update = useUpdateInkoopgroep()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmedCode = code.trim().toUpperCase().replace(/\s+/g, '')
    const trimmedNaam = naam.trim()
    if (!trimmedNaam) {
      setError('Naam is verplicht')
      return
    }
    if (!isEdit && !trimmedCode) {
      setError('Code is verplicht')
      return
    }
    try {
      if (isEdit && groep) {
        await update.mutateAsync({
          code: groep.code,
          data: {
            naam: trimmedNaam,
            omschrijving: omschrijving.trim() || null,
            actief,
          },
        })
      } else {
        await create.mutateAsync({
          code: trimmedCode,
          naam: trimmedNaam,
          omschrijving: omschrijving.trim() || null,
          actief,
        })
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Er ging iets mis')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-lg">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-medium text-lg">
            {isEdit ? 'Inkoopgroep bewerken' : 'Nieuwe inkoopgroep'}
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
              placeholder="bv. INKC60"
              className={`${inputClasses} ${isEdit ? 'bg-slate-50 text-slate-500' : ''}`}
              required={!isEdit}
            />
            {!isEdit && (
              <p className="text-xs text-slate-400 mt-1">
                Wordt genormaliseerd naar hoofdletters zonder spaties.
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
              placeholder="bv. BEGROS"
              className={inputClasses}
              required
              autoFocus={isEdit}
            />
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">Omschrijving</label>
            <textarea
              value={omschrijving}
              onChange={(e) => setOmschrijving(e.target.value)}
              rows={2}
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
            Actief
          </label>

          {error && (
            <div className="px-3 py-2 bg-rose-50 border border-rose-100 text-sm text-rose-700 rounded-[var(--radius-sm)]">
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
              disabled={create.isPending || update.isPending}
              className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 disabled:opacity-50"
            >
              {create.isPending || update.isPending
                ? 'Opslaan...'
                : isEdit
                  ? 'Opslaan'
                  : 'Aanmaken'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
