import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useUpsertVorm } from '../hooks/use-maatwerk-instellingen'
import type { MaatwerkVormRow } from '@/modules/maatwerk'

interface Props {
  vorm?: MaatwerkVormRow
  /** Volgende vrije volgorde-waarde voor nieuwe rijen. */
  defaultVolgorde?: number
  onClose: () => void
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

export function VormFormDialog({ vorm, defaultVolgorde, onClose }: Props) {
  const isEdit = Boolean(vorm)
  const [code, setCode] = useState(vorm?.code ?? '')
  const [naam, setNaam] = useState(vorm?.naam ?? '')
  const [afmetingType, setAfmetingType] = useState<MaatwerkVormRow['afmeting_type']>(
    vorm?.afmeting_type ?? 'lengte_breedte',
  )
  const [toeslag, setToeslag] = useState<string>(
    vorm?.toeslag !== undefined ? String(vorm.toeslag) : '0',
  )
  const [snijtijdMinuten, setSnijtijdMinuten] = useState<string>(
    vorm?.snijtijd_minuten !== undefined ? String(vorm.snijtijd_minuten) : '5',
  )
  const [volgorde, setVolgorde] = useState<string>(
    String(vorm?.volgorde ?? defaultVolgorde ?? 0),
  )
  const [actief, setActief] = useState(vorm?.actief ?? true)
  const [error, setError] = useState<string | null>(null)

  const upsert = useUpsertVorm()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmedCode = code.trim().toLowerCase().replace(/\s+/g, '_')
    const trimmedNaam = naam.trim()
    const toeslagNum = Number(toeslag.replace(',', '.'))
    const snijtijdNum = Number(snijtijdMinuten.replace(',', '.'))
    const volgordeNum = Number(volgorde)
    if (!trimmedNaam) {
      setError('Naam is verplicht')
      return
    }
    if (!isEdit && !trimmedCode) {
      setError('Code is verplicht')
      return
    }
    if (Number.isNaN(toeslagNum) || toeslagNum < 0) {
      setError('Toeslag moet een geldig (≥ 0) getal zijn')
      return
    }
    if (Number.isNaN(snijtijdNum) || snijtijdNum < 0) {
      setError('Snijtijd moet een geldig (≥ 0) getal zijn')
      return
    }
    if (Number.isNaN(volgordeNum)) {
      setError('Volgorde moet een geldig getal zijn')
      return
    }
    try {
      await upsert.mutateAsync({
        id: vorm?.id,
        code: trimmedCode,
        naam: trimmedNaam,
        afmeting_type: afmetingType,
        toeslag: toeslagNum,
        snijtijd_minuten: snijtijdNum,
        volgorde: volgordeNum,
        actief,
      })
      onClose()
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : JSON.stringify(err)
      setError(msg)
      console.error('[VormFormDialog] upsert mislukt:', err)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-lg">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-medium text-lg">
            {isEdit ? 'Vorm bewerken' : 'Nieuwe vorm'}
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
              placeholder="bv. organic"
              className={`${inputClasses} ${isEdit ? 'bg-slate-50 text-slate-500' : ''}`}
              required={!isEdit}
            />
            {!isEdit && (
              <p className="text-xs text-slate-400 mt-1">
                Wordt genormaliseerd naar kleine letters met underscores. Wordt opgeslagen in
                <code className="px-1 mx-0.5 bg-slate-100 rounded text-[11px]">producten.maatwerk_vorm_code</code>.
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
              placeholder="bv. Organic Gespiegeld"
              className={inputClasses}
              required
              autoFocus={isEdit}
            />
            <p className="text-xs text-slate-400 mt-1">Verschijnt in de Vorm-dropdown bij order aanmaken.</p>
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">Afmeting-type</label>
            <select
              value={afmetingType}
              onChange={(e) => setAfmetingType(e.target.value as MaatwerkVormRow['afmeting_type'])}
              className={inputClasses}
            >
              <option value="lengte_breedte">Lengte × Breedte</option>
              <option value="diameter">Diameter (cirkel)</option>
            </select>
            <p className="text-xs text-slate-400 mt-1">
              Bepaalt welke maatvelden zichtbaar worden in het order-formulier.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-slate-600 mb-1">Toeslag (€)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={toeslag}
                onChange={(e) => setToeslag(e.target.value)}
                className={inputClasses}
              />
              <p className="text-xs text-slate-400 mt-1">Bovenop de m²-prijs.</p>
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Snijtijd (min)</label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={snijtijdMinuten}
                onChange={(e) => setSnijtijdMinuten(e.target.value)}
                className={inputClasses}
              />
              <p className="text-xs text-slate-400 mt-1">Per stuk, voor planning/capaciteit.</p>
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Volgorde</label>
              <input
                type="number"
                step="1"
                value={volgorde}
                onChange={(e) => setVolgorde(e.target.value)}
                className={inputClasses}
              />
              <p className="text-xs text-slate-400 mt-1">Sortering in dropdown (laag = eerst).</p>
            </div>
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
              {upsert.isPending ? 'Opslaan...' : isEdit ? 'Opslaan' : 'Aanmaken'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
