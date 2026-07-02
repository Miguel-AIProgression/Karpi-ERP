import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useVoegRegelToe } from '../hooks/use-regel-mutaties'

interface Props {
  inkooporderId: number
  onClose: () => void
}

export function RegelToevoegenDialog({ inkooporderId, onClose }: Props) {
  const { isExternRep } = useAuth()
  const [artikelnr, setArtikelnr] = useState('')
  const [karpiCode, setKarpiCode] = useState('')
  const [omschrijving, setOmschrijving] = useState('')
  const [besteld, setBesteld] = useState('')
  const [prijs, setPrijs] = useState('')
  const [eenheid, setEenheid] = useState<'m' | 'stuks'>('m')
  const [error, setError] = useState<string | null>(null)

  const voegToe = useVoegRegelToe()

  // Externe vertegenwoordiger (mig 489): read-only — regel-mutaties niet toegestaan.
  if (isExternRep) return null

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const b = Number(besteld)
    if (!Number.isFinite(b) || b <= 0) {
      setError('Besteld moet > 0 zijn')
      return
    }
    if (!artikelnr.trim() && !karpiCode.trim()) {
      setError('Geef artikelnr of karpi-code op')
      return
    }
    try {
      await voegToe.mutateAsync({
        inkooporderId,
        regel: {
          artikelnr: artikelnr.trim() || null,
          karpi_code: karpiCode.trim() || null,
          artikel_omschrijving: omschrijving.trim() || null,
          besteld_m: b,
          inkoopprijs_eur: prijs ? Number(prijs) : null,
          eenheid,
        },
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Regel toevoegen mislukt')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-md">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-medium text-lg">Regel toevoegen</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-3">
          <label className="block text-sm">
            <span className="block mb-1 text-slate-600">Artikelnr</span>
            <input type="text" value={artikelnr} onChange={(e) => setArtikelnr(e.target.value)} className={inputClasses} />
          </label>
          <label className="block text-sm">
            <span className="block mb-1 text-slate-600">Karpi-code</span>
            <input type="text" value={karpiCode} onChange={(e) => setKarpiCode(e.target.value)} className={inputClasses} placeholder="bijv. TWIS15400VIL" />
          </label>
          <label className="block text-sm">
            <span className="block mb-1 text-slate-600">Omschrijving</span>
            <input type="text" value={omschrijving} onChange={(e) => setOmschrijving(e.target.value)} className={inputClasses} />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="text-sm">
              <span className="block mb-1 text-slate-600">Eenheid</span>
              <select value={eenheid} onChange={(e) => setEenheid(e.target.value as 'm' | 'stuks')} className={inputClasses}>
                <option value="m">m² (rol)</option>
                <option value="stuks">stuks</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="block mb-1 text-slate-600">Besteld</span>
              <input type="number" value={besteld} onChange={(e) => setBesteld(e.target.value)} className={inputClasses} step="0.01" min="0.01" required />
            </label>
            <label className="text-sm">
              <span className="block mb-1 text-slate-600">Prijs (€)</span>
              <input type="number" value={prijs} onChange={(e) => setPrijs(e.target.value)} className={inputClasses} step="0.01" min="0" />
            </label>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>}
          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">
              Annuleren
            </button>
            <button
              type="submit"
              disabled={voegToe.isPending}
              className="px-4 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50"
            >
              {voegToe.isPending ? 'Bezig…' : 'Regel toevoegen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'
