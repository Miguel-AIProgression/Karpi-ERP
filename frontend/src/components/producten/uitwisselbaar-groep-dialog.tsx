import { useMemo, useState, type FormEvent } from 'react'
import { X, Search, Check } from 'lucide-react'
import {
  useKoppelbareKwaliteiten,
  useCreateUitwisselbareGroep,
  useHernoemUitwisselbareGroep,
  useUpdateUitwisselbareGroepLeden,
} from '@/hooks/use-uitwisselbaar'
import type { UitwisselbareGroep } from '@/lib/supabase/queries/uitwisselbaar'

interface Props {
  /** Aanwezig = bewerken van een bestaande groep, afwezig = nieuwe groep aanmaken. */
  groep?: UitwisselbareGroep
  onClose: () => void
}

const MAX_VISIBLE = 200

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

export function UitwisselbaarGroepDialog({ groep, onClose }: Props) {
  const isEdit = Boolean(groep)
  const [naam, setNaam] = useState(groep?.collectie_naam ?? '')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(groep?.kwaliteiten.map((k) => k.code) ?? []),
  )
  const [error, setError] = useState<string | null>(null)

  const { data: kwaliteiten, isLoading } = useKoppelbareKwaliteiten()
  const create = useCreateUitwisselbareGroep()
  const hernoem = useHernoemUitwisselbareGroep()
  const updateLeden = useUpdateUitwisselbareGroepLeden()

  const isPending = create.isPending || hernoem.isPending || updateLeden.isPending

  const filtered = useMemo(() => {
    if (!kwaliteiten) return []
    const s = search.trim().toLowerCase()
    if (!s) return kwaliteiten.slice(0, MAX_VISIBLE)
    return kwaliteiten
      .filter(
        (k) =>
          k.code.toLowerCase().includes(s) ||
          (k.omschrijving?.toLowerCase().includes(s) ?? false),
      )
      .slice(0, MAX_VISIBLE)
  }, [kwaliteiten, search])

  const verplaatsCount = useMemo(() => {
    if (!kwaliteiten || selected.size === 0) return 0
    return kwaliteiten.filter(
      (k) =>
        selected.has(k.code) &&
        k.collectie_id !== null &&
        k.collectie_id !== (groep?.collectie_id ?? null),
    ).length
  }, [kwaliteiten, selected, groep])

  const toggle = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmedNaam = naam.trim()
    if (!trimmedNaam) {
      setError('Naam is verplicht')
      return
    }
    if (selected.size < 2) {
      setError('Kies minimaal 2 kwaliteiten — een groep van 1 is niet uitwisselbaar')
      return
    }
    try {
      if (isEdit && groep) {
        const huidigeCodes = new Set(groep.kwaliteiten.map((k) => k.code))
        const toevoegen = Array.from(selected).filter((c) => !huidigeCodes.has(c))
        const verwijderen = groep.kwaliteiten.map((k) => k.code).filter((c) => !selected.has(c))

        if (trimmedNaam !== groep.collectie_naam) {
          await hernoem.mutateAsync({ collectieId: groep.collectie_id, naam: trimmedNaam })
        }
        if (toevoegen.length > 0 || verwijderen.length > 0) {
          await updateLeden.mutateAsync({ collectieId: groep.collectie_id, toevoegen, verwijderen })
        }
      } else {
        await create.mutateAsync({ naam: trimmedNaam, kwaliteitCodes: Array.from(selected) })
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Er ging iets mis')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-medium text-lg">
            {isEdit ? 'Groep bewerken' : 'Nieuwe uitwisselbare groep'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 space-y-3">
            <div>
              <label className="block text-sm text-slate-600 mb-1">
                Naam <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={naam}
                onChange={(e) => setNaam(e.target.value)}
                placeholder="bv. Mirage/Renaissance/Coll"
                className={inputClasses}
                autoFocus
                required
              />
            </div>

            <div>
              <label className="block text-sm text-slate-600 mb-1">
                Kwaliteiten <span className="text-rose-500">*</span>{' '}
                <span className="text-slate-400 font-normal">(minimaal 2)</span>
              </label>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Zoek op code of omschrijving..."
                  className={`${inputClasses} pl-10`}
                />
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-5 text-sm text-slate-400">Laden...</div>
            ) : filtered.length === 0 ? (
              <div className="p-5 text-sm text-slate-400">Geen resultaten</div>
            ) : (
              <ul className="divide-y divide-slate-50">
                {filtered.map((k) => {
                  const isSel = selected.has(k.code)
                  const zitElders = k.collectie_id !== null && k.collectie_id !== (groep?.collectie_id ?? null)
                  return (
                    <li key={k.code}>
                      <button
                        type="button"
                        onClick={() => toggle(k.code)}
                        className={`w-full text-left px-6 py-2.5 text-sm flex items-center gap-3 ${
                          isSel ? 'bg-terracotta-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                            isSel
                              ? 'bg-terracotta-500 border-terracotta-500 text-white'
                              : 'border-slate-300 bg-white'
                          }`}
                        >
                          {isSel && <Check size={12} strokeWidth={3} />}
                        </span>
                        <span className="flex-1">
                          <span className="px-1.5 py-0.5 rounded bg-slate-200 text-[10px] font-mono text-slate-600 uppercase mr-2">
                            {k.code}
                          </span>
                          <span className="text-slate-700">{k.omschrijving ?? '—'}</span>
                        </span>
                        {zitElders && k.collectie_naam && (
                          <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded whitespace-nowrap">
                            zit in {k.collectie_naam}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {filtered.length === MAX_VISIBLE && (
              <div className="px-6 py-2 text-xs text-slate-400 text-center border-t border-slate-50">
                Eerste {MAX_VISIBLE} weergegeven — verfijn de zoekterm voor meer.
              </div>
            )}
          </div>

          {verplaatsCount > 0 && (
            <div className="px-6 py-3 bg-amber-50 border-t border-amber-100 text-sm text-amber-800">
              <strong>{verplaatsCount}</strong>{' '}
              {verplaatsCount === 1 ? 'kwaliteit zit' : 'kwaliteiten zitten'} nu nog in een andere
              groep — die koppeling wordt vervangen.
            </div>
          )}

          {error && (
            <div className="px-6 py-3 bg-rose-50 border-t border-rose-100 text-sm text-rose-700">
              {error}
            </div>
          )}

          <footer className="px-6 py-3 border-t border-slate-200 flex items-center justify-between gap-2">
            <span className="text-sm text-slate-500">
              {selected.size === 0 ? 'Niets geselecteerd' : `${selected.size} geselecteerd`}
            </span>
            <div className="flex items-center gap-2">
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
                {isPending ? 'Opslaan...' : isEdit ? 'Opslaan' : 'Aanmaken'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  )
}
