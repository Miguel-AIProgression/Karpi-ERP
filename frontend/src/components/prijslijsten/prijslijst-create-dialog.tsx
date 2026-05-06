import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useCreatePrijslijst, usePrijslijsten } from '@/hooks/use-prijslijsten'

interface Props {
  onClose: () => void
  onCreated: (nr: string) => void
}

/**
 * Stelt een nieuw 4-cijferig prijslijst-nr voor: max bestaand nr + 1, gepad met nullen.
 * Valt terug op "0001" als er nog geen prijslijsten zijn.
 */
function nextNr(bestaandeNrs: string[]): string {
  const numerics = bestaandeNrs
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isFinite(n))
  const max = numerics.length === 0 ? 0 : Math.max(...numerics)
  return String(max + 1).padStart(4, '0')
}

export function PrijslijstCreateDialog({ onClose, onCreated }: Props) {
  const { data: prijslijsten } = usePrijslijsten()
  const mutation = useCreatePrijslijst()

  const [nr, setNr] = useState('')
  const [naam, setNaam] = useState('')
  const [geldigVanaf, setGeldigVanaf] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [nrManueel, setNrManueel] = useState(false)

  const bestaandeNrs = useMemo(
    () => new Set(prijslijsten?.map((p) => p.nr) ?? []),
    [prijslijsten],
  )

  // Vul automatisch het volgende nr zodra de lijst geladen is, tenzij de
  // gebruiker zelf al iets heeft ingetypt.
  useEffect(() => {
    if (nrManueel) return
    if (!prijslijsten) return
    setNr(nextNr(prijslijsten.map((p) => p.nr)))
  }, [prijslijsten, nrManueel])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    const nrTrim = nr.trim()
    const naamTrim = naam.trim()

    if (!nrTrim) {
      setError('Vul een nummer in')
      return
    }
    if (!naamTrim) {
      setError('Vul een naam in')
      return
    }
    if (bestaandeNrs.has(nrTrim)) {
      setError(`Nr "${nrTrim}" bestaat al — kies een ander nummer`)
      return
    }

    try {
      const created = await mutation.mutateAsync({
        nr: nrTrim,
        naam: naamTrim,
        geldig_vanaf: geldigVanaf || null,
      })
      onCreated(created.nr)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Er ging iets mis')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-md flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-medium text-lg">Nieuwe prijslijst</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Nr
              </label>
              <input
                type="text"
                value={nr}
                onChange={(e) => {
                  setNrManueel(true)
                  setNr(e.target.value)
                }}
                placeholder="0210"
                className="w-32 px-3 py-2 text-sm font-mono border border-slate-200 rounded-[var(--radius-sm)] focus:outline-none focus:ring-1 focus:ring-terracotta-300 focus:border-terracotta-300"
              />
              <p className="text-xs text-slate-400 mt-1">
                Voorgesteld op basis van hoogste bestaande nr; pas aan indien gewenst.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Naam
              </label>
              <input
                type="text"
                value={naam}
                onChange={(e) => setNaam(e.target.value)}
                placeholder="Bijv. BENELUX PER 01.06.2026"
                autoFocus
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[var(--radius-sm)] focus:outline-none focus:ring-1 focus:ring-terracotta-300 focus:border-terracotta-300"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Geldig vanaf
              </label>
              <input
                type="date"
                value={geldigVanaf}
                onChange={(e) => setGeldigVanaf(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[var(--radius-sm)] focus:outline-none focus:ring-1 focus:ring-terracotta-300 focus:border-terracotta-300"
              />
              <p className="text-xs text-slate-400 mt-1">
                Optioneel — leeglaten kan altijd later ingevuld worden.
              </p>
            </div>
          </div>

          {error && (
            <div className="px-6 py-3 bg-rose-50 border-t border-rose-100 text-sm text-rose-700">
              {error}
            </div>
          )}

          <footer className="px-6 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
            >
              Annuleren
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 disabled:opacity-50"
            >
              {mutation.isPending ? 'Aanmaken...' : 'Aanmaken & producten toevoegen'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
