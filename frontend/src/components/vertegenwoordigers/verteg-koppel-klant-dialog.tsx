import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Search, X } from 'lucide-react'
import { useKoppelbareDebiteurenMetVerteg, useSetKlantVerteg } from '@/hooks/use-vertegenwoordigers'

interface Props {
  open: boolean
  onClose: () => void
  vertegCode: string
  vertegNaam: string
}

export function VertegKoppelKlantDialog({ open, onClose, vertegCode, vertegNaam }: Props) {
  const [search, setSearch] = useState('')
  const [confirmOverride, setConfirmOverride] = useState<{
    debiteurNr: number
    klantNaam: string
    huidigeVerteg: string
  } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: debiteuren, isLoading } = useKoppelbareDebiteurenMetVerteg()
  const mutation = useSetKlantVerteg()

  useEffect(() => {
    if (open) {
      setSearch('')
      setConfirmOverride(null)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const filtered = useMemo(() => {
    if (!debiteuren) return []
    const s = search.trim().toLowerCase()
    const list = debiteuren.filter((d) => d.vertegenw_code !== vertegCode)
    if (!s) return list.slice(0, 200)
    const numSearch = Number(s)
    return list
      .filter((d) => {
        if (numSearch && d.debiteur_nr === numSearch) return true
        return (
          d.naam.toLowerCase().includes(s) ||
          (d.plaats?.toLowerCase().includes(s) ?? false)
        )
      })
      .slice(0, 200)
  }, [debiteuren, search, vertegCode])

  const handlePick = async (debiteurNr: number, klantNaam: string, huidigeVerteg: string | null) => {
    if (huidigeVerteg) {
      setConfirmOverride({ debiteurNr, klantNaam, huidigeVerteg })
      return
    }
    await koppel(debiteurNr)
  }

  const koppel = async (debiteurNr: number) => {
    try {
      await mutation.mutateAsync({ debiteurNr, code: vertegCode })
      setConfirmOverride(null)
      onClose()
    } catch {
      // mutation.error wordt zichtbaar via UI
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm pt-24"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-xl max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Klant koppelen</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Aan vertegenwoordiger <span className="font-medium text-slate-700">{vertegNaam}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Zoek op naam, plaats of debiteur-nr..."
              className="w-full pl-8 pr-3 py-1.5 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-5 text-sm text-slate-400">Laden...</div>
          ) : filtered.length === 0 ? (
            <div className="p-5 text-sm text-slate-400">Geen klanten gevonden</div>
          ) : (
            <ul className="divide-y divide-slate-50">
              {filtered.map((d) => (
                <li key={d.debiteur_nr}>
                  <button
                    onClick={() => handlePick(d.debiteur_nr, d.naam, d.vertegenwoordiger_naam)}
                    disabled={mutation.isPending}
                    className="w-full text-left px-5 py-2.5 text-sm hover:bg-slate-50 disabled:opacity-50 flex items-center gap-3"
                  >
                    <span className="text-xs text-slate-400 font-mono w-14">{d.debiteur_nr}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium text-slate-900 truncate">{d.naam}</span>
                      {d.plaats && (
                        <span className="block text-xs text-slate-400 truncate">{d.plaats}</span>
                      )}
                    </span>
                    {d.vertegenwoordiger_naam && (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                        <AlertTriangle size={11} />
                        {d.vertegenwoordiger_naam}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 py-2 border-t border-slate-100 text-xs text-slate-400">
          {filtered.length} klant{filtered.length === 1 ? '' : 'en'} (klanten al gekoppeld aan deze verteg verborgen)
        </div>
      </div>

      {confirmOverride && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/40"
          onClick={() => setConfirmOverride(null)}
        >
          <div
            className="bg-white rounded-[var(--radius)] shadow-xl max-w-md w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-3">
              <AlertTriangle size={20} className="text-amber-500 mt-0.5 shrink-0" />
              <div>
                <h3 className="font-semibold text-slate-900 mb-1">Vertegenwoordiger overschrijven?</h3>
                <p className="text-sm text-slate-600">
                  <span className="font-medium">{confirmOverride.klantNaam}</span> is nu gekoppeld aan{' '}
                  <span className="font-medium">{confirmOverride.huidigeVerteg}</span>. Een klant kan maar
                  aan één vertegenwoordiger gekoppeld zijn.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setConfirmOverride(null)}
                className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-[var(--radius-sm)]"
              >
                Annuleren
              </button>
              <button
                onClick={() => koppel(confirmOverride.debiteurNr)}
                disabled={mutation.isPending}
                className="px-3 py-1.5 text-sm bg-terracotta-500 text-white rounded-[var(--radius-sm)] hover:bg-terracotta-600 disabled:opacity-50"
              >
                {mutation.isPending ? 'Bezig...' : `Overschrijven naar ${vertegNaam}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
