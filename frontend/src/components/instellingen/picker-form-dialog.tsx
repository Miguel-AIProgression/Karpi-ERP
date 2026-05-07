import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useCreatePicker, useUpdateMedewerker } from '@/hooks/use-medewerkers'
import type { Medewerker } from '@/lib/supabase/queries/medewerkers'

interface Props {
  picker?: Medewerker
  onClose: () => void
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

export function PickerFormDialog({ picker, onClose }: Props) {
  const isEdit = Boolean(picker)
  const [naam, setNaam] = useState(picker?.naam ?? '')
  const [actief, setActief] = useState(picker?.actief ?? true)
  const [error, setError] = useState<string | null>(null)

  const createMut = useCreatePicker()
  const updateMut = useUpdateMedewerker()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmed = naam.trim()
    if (!trimmed) {
      setError('Naam is verplicht')
      return
    }

    try {
      if (isEdit && picker) {
        await updateMut.mutateAsync({ id: picker.id, patch: { naam: trimmed, actief } })
      } else {
        const nieuw = await createMut.mutateAsync(trimmed)
        if (!actief) {
          await updateMut.mutateAsync({ id: nieuw.id, patch: { actief: false } })
        }
      }
      onClose()
    } catch (err) {
      console.error('[PickerFormDialog]', err)
      const e = err as { message?: unknown } | null
      setError(typeof e?.message === 'string' ? e.message : 'Onbekende fout — zie console')
    }
  }

  const isPending = createMut.isPending || updateMut.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-md">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-medium text-lg">
            {isEdit ? 'Picker bewerken' : 'Nieuwe picker'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm text-slate-600 mb-1">
              Naam <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={naam}
              onChange={(e) => setNaam(e.target.value)}
              placeholder="bv. Jan de Vries"
              className={inputClasses}
              required
              autoFocus
            />
            <p className="text-xs text-slate-400 mt-1">
              Verschijnt in de dropdown bij start/voltooi van een pickronde.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={actief}
              onChange={(e) => setActief(e.target.checked)}
              className="rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400"
            />
            Actief (zichtbaar in pick-dropdown)
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
              disabled={isPending}
              className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 disabled:opacity-50"
            >
              {isPending ? 'Opslaan…' : 'Opslaan'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
