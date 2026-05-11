import { useEffect, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useUpsertKlanteigenNaam, useKwaliteitCodes } from '../hooks/use-klanteigen-namen'

interface InitialValues {
  id?: number | null
  kwaliteit_code?: string
  kleur_code?: string | null
  benaming?: string
  omschrijving?: string | null
  leverancier?: string | null
}

interface Props {
  /** Eigenaar — debiteur OF inkoopgroep, één van beide moet gevuld zijn. */
  debiteurNr?: number
  inkoopgroepCode?: string
  /** Vooringevulde waarden bij bewerken of "overerving overschrijven". */
  initial?: InitialValues
  onClose: () => void
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

export function KlanteigenNaamDialog({ debiteurNr, inkoopgroepCode, initial, onClose }: Props) {
  const [kwaliteit, setKwaliteit] = useState(initial?.kwaliteit_code ?? '')
  const [kleur, setKleur] = useState(initial?.kleur_code ?? '')
  const [benaming, setBenaming] = useState(initial?.benaming ?? '')
  const [omschrijving, setOmschrijving] = useState(initial?.omschrijving ?? '')
  const [leverancier, setLeverancier] = useState(initial?.leverancier ?? '')
  const [error, setError] = useState<string | null>(null)

  const { data: kwaliteiten } = useKwaliteitCodes()
  const upsert = useUpsertKlanteigenNaam()

  // Lock kwaliteit-veld bij bewerken — een eigen alias muteren betekent niet
  // de sleutel veranderen.
  const isEdit = Boolean(initial?.id)

  useEffect(() => {
    if (!debiteurNr && !inkoopgroepCode) {
      setError('Geen eigenaar (debiteur of inkoopgroep) opgegeven')
    }
  }, [debiteurNr, inkoopgroepCode])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const k = kwaliteit.trim().toUpperCase()
    if (!k) return setError('Kwaliteit is verplicht')
    if (!benaming.trim()) return setError('Benaming is verplicht')

    try {
      await upsert.mutateAsync({
        debiteur_nr: debiteurNr ?? null,
        inkoopgroep_code: inkoopgroepCode ?? null,
        kwaliteit_code: k,
        kleur_code: kleur.trim() || null,
        benaming: benaming.trim(),
        omschrijving: omschrijving.trim() || null,
        leverancier: leverancier.trim() || null,
      })
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
            {isEdit ? 'Eigen benaming bewerken' : 'Eigen benaming toevoegen'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-600 mb-1">
                Kwaliteit <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                list="kwaliteit-codes"
                value={kwaliteit}
                onChange={(e) => setKwaliteit(e.target.value.toUpperCase())}
                disabled={isEdit}
                placeholder="bv. BEAC"
                className={`${inputClasses} font-mono ${isEdit ? 'bg-slate-50 text-slate-500' : ''}`}
                required
                maxLength={6}
              />
              <datalist id="kwaliteit-codes">
                {(kwaliteiten ?? []).slice(0, 500).map((k) => (
                  <option key={k.code} value={k.code}>
                    {k.omschrijving ?? ''}
                  </option>
                ))}
              </datalist>
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">
                Kleur <span className="text-slate-400 text-xs">(optioneel)</span>
              </label>
              <input
                type="text"
                value={kleur}
                onChange={(e) => setKleur(e.target.value)}
                disabled={isEdit}
                placeholder="leeg = alle kleuren"
                className={`${inputClasses} font-mono ${isEdit ? 'bg-slate-50 text-slate-500' : ''}`}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">
              Eigen benaming <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={benaming}
              onChange={(e) => setBenaming(e.target.value)}
              placeholder="bv. BREDA"
              className={inputClasses}
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">Omschrijving</label>
            <input
              type="text"
              value={omschrijving}
              onChange={(e) => setOmschrijving(e.target.value)}
              className={inputClasses}
            />
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">Leverancier</label>
            <input
              type="text"
              value={leverancier}
              onChange={(e) => setLeverancier(e.target.value)}
              className={inputClasses}
            />
          </div>

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
              disabled={upsert.isPending}
              className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 disabled:opacity-50"
            >
              {upsert.isPending ? 'Opslaan...' : 'Opslaan'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
