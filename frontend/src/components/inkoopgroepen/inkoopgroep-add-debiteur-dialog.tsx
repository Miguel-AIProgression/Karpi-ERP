import { useMemo, useState, type FormEvent } from 'react'
import { X, Search, Check } from 'lucide-react'
import {
  useKoppelbareDebiteuren,
  useSetDebiteurenInkoopgroep,
} from '@/hooks/use-inkoopgroepen'

interface Props {
  inkoopgroepCode: string
  inkoopgroepNaam: string
  onClose: () => void
}

const MAX_VISIBLE = 200

export function InkoopgroepAddDebiteurDialog({
  inkoopgroepCode,
  inkoopgroepNaam,
  onClose,
}: Props) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const { data: debiteuren, isLoading } = useKoppelbareDebiteuren()
  const mutation = useSetDebiteurenInkoopgroep()

  const filtered = useMemo(() => {
    if (!debiteuren) return []
    const list = debiteuren.filter((d) => d.inkoopgroep_code !== inkoopgroepCode)
    const s = search.trim().toLowerCase()
    if (!s) return list.slice(0, MAX_VISIBLE)
    return list
      .filter(
        (d) =>
          d.naam.toLowerCase().includes(s) ||
          String(d.debiteur_nr).includes(s) ||
          (d.plaats?.toLowerCase().includes(s) ?? false),
      )
      .slice(0, MAX_VISIBLE)
  }, [debiteuren, search, inkoopgroepCode])

  const verplaatsCount = useMemo(() => {
    if (!debiteuren || selected.size === 0) return 0
    return debiteuren.filter(
      (d) =>
        selected.has(d.debiteur_nr) &&
        d.inkoopgroep_code !== null &&
        d.inkoopgroep_code !== inkoopgroepCode,
    ).length
  }, [debiteuren, selected, inkoopgroepCode])

  const toggle = (debiteurNr: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(debiteurNr)) next.delete(debiteurNr)
      else next.add(debiteurNr)
      return next
    })
  }

  const toggleAllVisible = () => {
    const visibleNrs = filtered.map((d) => d.debiteur_nr)
    const allSelected = visibleNrs.every((n) => selected.has(n))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const n of visibleNrs) next.delete(n)
      } else {
        for (const n of visibleNrs) next.add(n)
      }
      return next
    })
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (selected.size === 0) {
      setError('Kies eerst minimaal één debiteur')
      return
    }
    try {
      await mutation.mutateAsync({
        debiteurNrs: Array.from(selected),
        code: inkoopgroepCode,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Er ging iets mis')
    }
  }

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((d) => selected.has(d.debiteur_nr))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-medium text-lg">
            Debiteur toevoegen aan{' '}
            <span className="text-terracotta-600">{inkoopgroepNaam}</span>
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Zoek op naam, debiteur-nr of plaats..."
                autoFocus
                className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
              />
            </div>
            {filtered.length > 0 && (
              <button
                type="button"
                onClick={toggleAllVisible}
                className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium whitespace-nowrap"
              >
                {allVisibleSelected ? 'Deselecteer zichtbare' : 'Selecteer zichtbare'}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-5 text-sm text-slate-400">Laden...</div>
            ) : filtered.length === 0 ? (
              <div className="p-5 text-sm text-slate-400">Geen resultaten</div>
            ) : (
              <ul className="divide-y divide-slate-50">
                {filtered.map((d) => {
                  const isSel = selected.has(d.debiteur_nr)
                  return (
                    <li key={d.debiteur_nr}>
                      <button
                        type="button"
                        onClick={() => toggle(d.debiteur_nr)}
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
                          <span className="font-medium text-slate-700">{d.naam}</span>
                          <span className="text-slate-400 ml-2">#{d.debiteur_nr}</span>
                          {d.plaats && (
                            <span className="text-slate-400 ml-2">— {d.plaats}</span>
                          )}
                        </span>
                        {d.inkoopgroep_code && (
                          <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                            zit in {d.inkoopgroep_code}
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
              {verplaatsCount === 1 ? 'debiteur hangt' : 'debiteuren hangen'} nu nog aan een andere
              inkoopgroep — die koppeling wordt vervangen.
            </div>
          )}

          {error && (
            <div className="px-6 py-3 bg-rose-50 border-t border-rose-100 text-sm text-rose-700">
              {error}
            </div>
          )}

          <footer className="px-6 py-3 border-t border-slate-200 flex items-center justify-between gap-2">
            <span className="text-sm text-slate-500">
              {selected.size === 0
                ? 'Niets geselecteerd'
                : `${selected.size} geselecteerd`}
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
                disabled={selected.size === 0 || mutation.isPending}
                className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 disabled:opacity-50"
              >
                {mutation.isPending
                  ? 'Toevoegen...'
                  : `Toevoegen${selected.size > 0 ? ` (${selected.size})` : ''}`}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  )
}
