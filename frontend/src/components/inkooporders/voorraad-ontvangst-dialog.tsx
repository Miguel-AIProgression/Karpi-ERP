import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useBoekVoorraadOntvangst } from '@/hooks/use-inkooporders'
import type { InkooporderRegel } from '@/lib/supabase/queries/inkooporders'

interface Props {
  regel: InkooporderRegel
  inkooporderNr: string
  onClose: () => void
}

function formatAantal(value: number): string {
  return value.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
}

export function VoorraadOntvangstDialog({ regel, inkooporderNr, onClose }: Props) {
  const [aantal, setAantal] = useState<string>(String(Math.floor(regel.te_leveren_m)))
  const [medewerker, setMedewerker] = useState('')
  const [error, setError] = useState<string | null>(null)

  const boek = useBoekVoorraadOntvangst()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const n = Number(aantal)
    if (!Number.isFinite(n) || n <= 0) {
      setError('Aantal moet > 0 zijn')
      return
    }
    if (n > regel.te_leveren_m) {
      setError(`Maximaal ${regel.te_leveren_m} stuks te ontvangen`)
      return
    }
    try {
      await boek.mutateAsync({
        regelId: regel.id,
        aantal: Math.floor(n),
        medewerker: medewerker || undefined,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ontvangst boeken mislukt')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-md">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="font-medium text-lg">Voorraad-ontvangst boeken</h2>
            <p className="text-sm text-slate-500">
              {inkooporderNr} · regel {regel.regelnummer} · {regel.karpi_code ?? regel.artikelnr ?? '-'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 rounded-[var(--radius-sm)] text-sm">
            <div>
              <span className="text-slate-500">Besteld</span>
              <p className="font-medium">{formatAantal(regel.besteld_m)} st.</p>
            </div>
            <div>
              <span className="text-slate-500">Al geleverd</span>
              <p className="font-medium">{formatAantal(regel.geleverd_m)} st.</p>
            </div>
            <div>
              <span className="text-slate-500">Nog te leveren</span>
              <p className="font-medium text-slate-800">{formatAantal(regel.te_leveren_m)} st.</p>
            </div>
          </div>

          <label className="block text-sm">
            <span className="block mb-1 text-slate-600">Aantal nu ontvangen (stuks)</span>
            <input
              type="number"
              value={aantal}
              onChange={(e) => setAantal(e.target.value)}
              className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
              min="1"
              step="1"
              required
            />
          </label>

          <label className="block text-sm">
            <span className="block mb-1 text-slate-600">Medewerker (optioneel)</span>
            <input
              type="text"
              value={medewerker}
              onChange={(e) => setMedewerker(e.target.value)}
              className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm"
              placeholder="Naam"
            />
          </label>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>
          )}

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
            >
              Annuleren
            </button>
            <button
              type="submit"
              disabled={boek.isPending}
              className="px-4 py-2 bg-emerald-600 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {boek.isPending ? 'Bezig…' : 'Voorraad ophogen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
