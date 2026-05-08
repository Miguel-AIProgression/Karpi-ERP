import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useUpsertAfwerking, useTypeBewerkingen } from '../hooks/use-maatwerk-instellingen'
import type { AfwerkingTypeRow } from '@/modules/maatwerk'

interface Props {
  afwerking?: AfwerkingTypeRow
  defaultVolgorde?: number
  onClose: () => void
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

export function AfwerkingFormDialog({ afwerking, defaultVolgorde, onClose }: Props) {
  const isEdit = Boolean(afwerking)
  const [code, setCode] = useState(afwerking?.code ?? '')
  const [naam, setNaam] = useState(afwerking?.naam ?? '')
  const [prijsPerMeter, setPrijsPerMeter] = useState<string>(
    afwerking?.prijs_per_meter !== undefined ? String(afwerking.prijs_per_meter) : '0',
  )
  const [heeftBandKleur, setHeeftBandKleur] = useState(afwerking?.heeft_band_kleur ?? false)
  const [typeBewerking, setTypeBewerking] = useState<string>(afwerking?.type_bewerking ?? '')
  const [volgorde, setVolgorde] = useState<string>(
    String(afwerking?.volgorde ?? defaultVolgorde ?? 0),
  )
  const [actief, setActief] = useState(afwerking?.actief ?? true)
  const [error, setError] = useState<string | null>(null)

  const upsert = useUpsertAfwerking()
  const { data: lanes } = useTypeBewerkingen()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmedCode = code.trim().toUpperCase().replace(/\s+/g, '')
    const trimmedNaam = naam.trim()
    const prijsPerMeterNum = Number(prijsPerMeter.replace(',', '.'))
    const volgordeNum = Number(volgorde)
    if (!trimmedNaam) {
      setError('Naam is verplicht')
      return
    }
    if (!isEdit && !trimmedCode) {
      setError('Code is verplicht')
      return
    }
    if (Number.isNaN(prijsPerMeterNum) || prijsPerMeterNum < 0) {
      setError('Prijs per strekkende meter moet een geldig (≥ 0) getal zijn')
      return
    }
    if (Number.isNaN(volgordeNum)) {
      setError('Volgorde moet een geldig getal zijn')
      return
    }
    try {
      await upsert.mutateAsync({
        id: afwerking?.id,
        code: trimmedCode,
        naam: trimmedNaam,
        // Legacy `prijs`-kolom blijft op 0; UI exposed alleen prijs_per_meter.
        prijs: afwerking?.prijs ?? 0,
        prijs_per_meter: prijsPerMeterNum,
        heeft_band_kleur: heeftBandKleur,
        type_bewerking: typeBewerking.trim() === '' ? null : typeBewerking,
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
      console.error('[AfwerkingFormDialog] upsert mislukt:', err)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-lg">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-medium text-lg">
            {isEdit ? 'Afwerking bewerken' : 'Nieuwe afwerking'}
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
              placeholder="bv. SB"
              className={`${inputClasses} ${isEdit ? 'bg-slate-50 text-slate-500' : ''}`}
              required={!isEdit}
            />
            {!isEdit && (
              <p className="text-xs text-slate-400 mt-1">
                Korte unieke code (max 4 letters), wordt automatisch hoofdletters.
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
              placeholder="bv. Smalband"
              className={inputClasses}
              required
              autoFocus={isEdit}
            />
            <p className="text-xs text-slate-400 mt-1">Verschijnt in de Afwerking-dropdown bij order aanmaken.</p>
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">
              Confectie-lane (type_bewerking)
            </label>
            <select
              value={typeBewerking}
              onChange={(e) => setTypeBewerking(e.target.value)}
              className={inputClasses}
            >
              <option value="">— Geen (alleen stickeren) —</option>
              {(lanes ?? []).map((lane) => (
                <option key={lane} value={lane}>
                  {lane}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">
              Bepaalt naar welke confectie-lane werk loopt. Leeg = geen lane (zoals ON, ZO).
              Lijst komt uit <code className="px-1 mx-0.5 bg-slate-100 rounded text-[11px]">confectie_werktijden</code>.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-600 mb-1">Prijs per strekkende meter (€)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={prijsPerMeter}
                onChange={(e) => setPrijsPerMeter(e.target.value)}
                className={inputClasses}
              />
              <p className="text-xs text-slate-400 mt-1">× tapijt-omtrek.</p>
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
              <p className="text-xs text-slate-400 mt-1">Sortering in dropdown.</p>
            </div>
          </div>
          <p className="text-xs text-slate-500 -mt-2">
            Afwerkingsprijs op orderregel ={' '}
            <code className="px-1 bg-slate-100 rounded text-[11px]">omtrek_m × prijs/m</code>.
            Een 200×300 cm tapijt = 10&nbsp;m omtrek × tarief. Bij rond = π × diameter / 100.
          </p>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={heeftBandKleur}
              onChange={(e) => setHeeftBandKleur(e.target.checked)}
              className="rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400"
            />
            Heeft bandkleur (vraagt om kleurkeuze in order-form)
          </label>

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
