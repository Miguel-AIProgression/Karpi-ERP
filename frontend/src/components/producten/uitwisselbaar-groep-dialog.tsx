import { useMemo, useState, type FormEvent } from 'react'
import { X, Search, Check } from 'lucide-react'
import {
  useUitwisselbareGroepen,
  useKoppelbareKwaliteiten,
  useCreateUitwisselbareGroep,
  useHernoemUitwisselbareGroep,
  useUpdateUitwisselbareGroepLeden,
} from '@/hooks/use-uitwisselbaar'
import type { UitwisselbareGroep } from '@/lib/supabase/queries/uitwisselbaar'

interface Props {
  /** Aanwezig = bewerken van een bestaande groep, afwezig = koppeling toevoegen (nieuw of aan bestaande groep). */
  groep?: UitwisselbareGroep
  onClose: () => void
}

const MAX_VISIBLE = 200

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

function KwaliteitKleurBadges({ kleuren }: { kleuren: string[] }) {
  if (kleuren.length === 0) return <span className="text-xs text-slate-300">geen kleuren</span>
  return (
    <span className="flex flex-wrap gap-1">
      {kleuren.map((kleur) => (
        <span
          key={kleur}
          className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[10px] font-mono"
        >
          {kleur}
        </span>
      ))}
    </span>
  )
}

export function UitwisselbaarGroepDialog({ groep, onClose }: Props) {
  const isEdit = Boolean(groep)
  const [naam, setNaam] = useState(groep?.collectie_naam ?? '')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(groep?.kwaliteiten.map((k) => k.code) ?? []),
  )
  const [bestemming, setBestemming] = useState<'nieuw' | 'bestaand'>('nieuw')
  const [bestaandeGroepId, setBestaandeGroepId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: kwaliteiten, isLoading } = useKoppelbareKwaliteiten()
  const { data: groepen } = useUitwisselbareGroepen()
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
          (k.omschrijving?.toLowerCase().includes(s) ?? false) ||
          k.kleuren.some((kleur) => kleur.toLowerCase().includes(s)),
      )
      .slice(0, MAX_VISIBLE)
  }, [kwaliteiten, search])

  const doelGroepId = isEdit ? groep!.collectie_id : bestemming === 'bestaand' ? bestaandeGroepId : null

  const verplaatsCount = useMemo(() => {
    if (!kwaliteiten || selected.size === 0) return 0
    return kwaliteiten.filter(
      (k) => selected.has(k.code) && k.collectie_id !== null && k.collectie_id !== doelGroepId,
    ).length
  }, [kwaliteiten, selected, doelGroepId])

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

    if (selected.size === 0) {
      setError('Kies minimaal 1 kwaliteit')
      return
    }

    try {
      if (isEdit && groep) {
        const trimmedNaam = naam.trim()
        if (!trimmedNaam) {
          setError('Naam is verplicht')
          return
        }
        if (selected.size < 2) {
          setError('Kies minimaal 2 kwaliteiten — een groep van 1 is niet uitwisselbaar')
          return
        }
        const huidigeCodes = new Set(groep.kwaliteiten.map((k) => k.code))
        const toevoegen = Array.from(selected).filter((c) => !huidigeCodes.has(c))
        const verwijderen = groep.kwaliteiten.map((k) => k.code).filter((c) => !selected.has(c))

        if (trimmedNaam !== groep.collectie_naam) {
          await hernoem.mutateAsync({ collectieId: groep.collectie_id, naam: trimmedNaam })
        }
        if (toevoegen.length > 0 || verwijderen.length > 0) {
          await updateLeden.mutateAsync({ collectieId: groep.collectie_id, toevoegen, verwijderen })
        }
      } else if (bestemming === 'bestaand') {
        if (!bestaandeGroepId) {
          setError('Kies een bestaande groep')
          return
        }
        await updateLeden.mutateAsync({
          collectieId: bestaandeGroepId,
          toevoegen: Array.from(selected),
          verwijderen: [],
        })
      } else {
        const trimmedNaam = naam.trim()
        if (!trimmedNaam) {
          setError('Naam is verplicht')
          return
        }
        if (selected.size < 2) {
          setError('Kies minimaal 2 kwaliteiten — een groep van 1 is niet uitwisselbaar')
          return
        }
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
            {isEdit ? 'Groep bewerken' : 'Koppeling toevoegen'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 space-y-3">
            <div>
              <label className="block text-sm text-slate-600 mb-1">
                Kwaliteiten <span className="text-rose-500">*</span>{' '}
                <span className="text-slate-400 font-normal">
                  {isEdit || bestemming === 'nieuw' ? '(minimaal 2)' : '(minimaal 1)'}
                </span>
              </label>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Zoek op kwaliteitscode, omschrijving of kleur..."
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
                  const zitElders = k.collectie_id !== null && k.collectie_id !== doelGroepId
                  return (
                    <li key={k.code}>
                      <button
                        type="button"
                        onClick={() => toggle(k.code)}
                        className={`w-full text-left px-6 py-2.5 text-sm flex items-start gap-3 ${
                          isSel ? 'bg-terracotta-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`flex-shrink-0 mt-0.5 w-4 h-4 rounded border flex items-center justify-center ${
                            isSel
                              ? 'bg-terracotta-500 border-terracotta-500 text-white'
                              : 'border-slate-300 bg-white'
                          }`}
                        >
                          {isSel && <Check size={12} strokeWidth={3} />}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2 mb-1">
                            <span className="px-1.5 py-0.5 rounded bg-slate-200 text-[10px] font-mono text-slate-600 uppercase">
                              {k.code}
                            </span>
                            <span className="text-slate-700 truncate">{k.omschrijving ?? '—'}</span>
                            {zitElders && k.collectie_naam && (
                              <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded whitespace-nowrap ml-auto">
                                zit in {k.collectie_naam}
                              </span>
                            )}
                          </span>
                          <KwaliteitKleurBadges kleuren={k.kleuren} />
                        </span>
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

          <div className="px-6 py-4 border-t border-slate-100 space-y-3">
            {isEdit ? (
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
                  required
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm text-slate-600 mb-2">Bestemming</label>
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setBestemming('nieuw')}
                    className={`flex-1 px-3 py-2 rounded-[var(--radius-sm)] border text-sm transition-colors ${
                      bestemming === 'nieuw'
                        ? 'border-terracotta-400 bg-terracotta-50 text-terracotta-700 font-medium'
                        : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    Nieuwe groep
                  </button>
                  <button
                    type="button"
                    onClick={() => setBestemming('bestaand')}
                    className={`flex-1 px-3 py-2 rounded-[var(--radius-sm)] border text-sm transition-colors ${
                      bestemming === 'bestaand'
                        ? 'border-terracotta-400 bg-terracotta-50 text-terracotta-700 font-medium'
                        : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    Bestaande groep
                  </button>
                </div>

                {bestemming === 'nieuw' ? (
                  <input
                    type="text"
                    value={naam}
                    onChange={(e) => setNaam(e.target.value)}
                    placeholder="Naam van de nieuwe groep, bv. Mirage/Renaissance/Coll"
                    className={inputClasses}
                  />
                ) : (
                  <select
                    value={bestaandeGroepId ?? ''}
                    onChange={(e) => setBestaandeGroepId(e.target.value ? Number(e.target.value) : null)}
                    className={inputClasses}
                  >
                    <option value="">Kies een groep...</option>
                    {(groepen ?? []).map((g) => (
                      <option key={g.collectie_id} value={g.collectie_id}>
                        {g.collectie_naam} ({g.kwaliteiten.length} kwaliteiten)
                      </option>
                    ))}
                  </select>
                )}
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
                {isPending ? 'Opslaan...' : isEdit ? 'Opslaan' : 'Toevoegen'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  )
}
