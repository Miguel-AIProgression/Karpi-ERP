import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, X } from 'lucide-react'
import { useCreateInkooporder } from '@/hooks/use-inkooporders'
import { useLeveranciersOverzicht } from '@/hooks/use-leveranciers'
import type { InkooporderFormData, InkooporderRegelInput } from '@/lib/supabase/queries/inkooporders'

interface Props {
  onClose: () => void
}

interface RegelInput {
  artikelnr: string
  karpi_code: string
  artikel_omschrijving: string
  besteld_m: string
  inkoopprijs_eur: string
}

const legeRegel = (): RegelInput => ({
  artikelnr: '',
  karpi_code: '',
  artikel_omschrijving: '',
  besteld_m: '',
  inkoopprijs_eur: '',
})

export function InkooporderFormDialog({ onClose }: Props) {
  const navigate = useNavigate()
  const { data: leveranciers = [] } = useLeveranciersOverzicht()
  const [header, setHeader] = useState<Omit<InkooporderFormData, 'leverancier_id'> & { leverancier_id: string }>({
    leverancier_id: '',
    besteldatum: new Date().toISOString().slice(0, 10),
    leverweek: '',
    verwacht_datum: null,
    status: 'Besteld',
    opmerkingen: null,
  })
  const [regels, setRegels] = useState<RegelInput[]>([legeRegel()])
  const [error, setError] = useState<string | null>(null)

  const create = useCreateInkooporder()

  const voegRegelToe = () => setRegels((r) => [...r, legeRegel()])
  const verwijderRegel = (idx: number) => setRegels((r) => r.filter((_, i) => i !== idx))
  const wijzigRegel = (idx: number, veld: keyof RegelInput, waarde: string) =>
    setRegels((r) => r.map((rx, i) => (i === idx ? { ...rx, [veld]: waarde } : rx)))

  const totaalMeter = regels.reduce((s, r) => s + (Number(r.besteld_m) || 0), 0)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!header.leverancier_id) {
      setError('Leverancier is verplicht')
      return
    }

    const geldig: InkooporderRegelInput[] = []
    for (const [i, r] of regels.entries()) {
      const besteld = Number(r.besteld_m)
      if (!Number.isFinite(besteld) || besteld <= 0) {
        setError(`Regel ${i + 1}: Besteld (m) moet > 0 zijn`)
        return
      }
      if (!r.artikelnr.trim() && !r.karpi_code.trim()) {
        setError(`Regel ${i + 1}: geef artikelnr of karpi-code op`)
        return
      }
      geldig.push({
        regelnummer: i + 1,
        artikelnr: r.artikelnr.trim() || null,
        karpi_code: r.karpi_code.trim() || null,
        artikel_omschrijving: r.artikel_omschrijving.trim() || null,
        besteld_m: besteld,
        inkoopprijs_eur: r.inkoopprijs_eur ? Number(r.inkoopprijs_eur) : null,
      })
    }

    try {
      const id = await create.mutateAsync({
        header: {
          ...header,
          leverancier_id: Number(header.leverancier_id),
          opmerkingen: header.opmerkingen || null,
          leverweek: header.leverweek || null,
          verwacht_datum: header.verwacht_datum || null,
        },
        regels: geldig,
      })
      onClose()
      navigate(`/inkoop/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order aanmaken mislukt')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-medium text-lg">Nieuwe inkooporder</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Veld label="Leverancier *">
              <select
                value={header.leverancier_id}
                onChange={(e) => setHeader({ ...header, leverancier_id: e.target.value })}
                className={inputClasses}
                required
              >
                <option value="">Kies een leverancier…</option>
                {leveranciers
                  .filter((l) => l.actief)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.naam}
                    </option>
                  ))}
              </select>
            </Veld>
            <Veld label="Besteldatum">
              <input
                type="date"
                value={header.besteldatum ?? ''}
                onChange={(e) => setHeader({ ...header, besteldatum: e.target.value || null })}
                className={inputClasses}
              />
            </Veld>
            <Veld label="Leverweek (bijv. 23/2026)">
              <input
                type="text"
                value={header.leverweek ?? ''}
                onChange={(e) => setHeader({ ...header, leverweek: e.target.value })}
                className={inputClasses}
                placeholder="18/2026"
              />
            </Veld>
            <Veld label="Verwachte leverdatum">
              <input
                type="date"
                value={header.verwacht_datum ?? ''}
                onChange={(e) => setHeader({ ...header, verwacht_datum: e.target.value || null })}
                className={inputClasses}
              />
            </Veld>
            <Veld label="Opmerkingen" full>
              <textarea
                value={header.opmerkingen ?? ''}
                onChange={(e) => setHeader({ ...header, opmerkingen: e.target.value })}
                className={`${inputClasses} h-20`}
              />
            </Veld>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-sm">Regels</h3>
              <span className="text-sm text-slate-500">
                Totaal besteld: <strong>{totaalMeter.toFixed(1)}</strong>{' '}
                <span className="text-xs text-slate-400">m² (rollen) of stuks (vast)</span>
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="text-left pb-2 font-medium w-10">#</th>
                    <th className="text-left pb-2 font-medium">Artikelnr</th>
                    <th className="text-left pb-2 font-medium">Karpi-code</th>
                    <th className="text-left pb-2 font-medium">Omschrijving</th>
                    <th className="text-right pb-2 font-medium w-24">Besteld</th>
                    <th className="text-right pb-2 font-medium w-28">Prijs (€)</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {regels.map((r, idx) => (
                    <tr key={idx}>
                      <td className="py-1 text-slate-400">{idx + 1}</td>
                      <td className="py-1 pr-2">
                        <input
                          type="text"
                          value={r.artikelnr}
                          onChange={(e) => wijzigRegel(idx, 'artikelnr', e.target.value)}
                          className={`w-full ${inputClasses}`}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="text"
                          value={r.karpi_code}
                          onChange={(e) => wijzigRegel(idx, 'karpi_code', e.target.value)}
                          className={`w-full ${inputClasses}`}
                          placeholder="bijv. TWIS15400VIL"
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="text"
                          value={r.artikel_omschrijving}
                          onChange={(e) => wijzigRegel(idx, 'artikel_omschrijving', e.target.value)}
                          className={`w-full ${inputClasses}`}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="number"
                          value={r.besteld_m}
                          onChange={(e) => wijzigRegel(idx, 'besteld_m', e.target.value)}
                          className={`w-full text-right ${inputClasses}`}
                          step="0.01"
                          min="0"
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="number"
                          value={r.inkoopprijs_eur}
                          onChange={(e) => wijzigRegel(idx, 'inkoopprijs_eur', e.target.value)}
                          className={`w-full text-right ${inputClasses}`}
                          step="0.01"
                          min="0"
                        />
                      </td>
                      <td className="py-1">
                        <button
                          type="button"
                          onClick={() => verwijderRegel(idx)}
                          disabled={regels.length === 1}
                          className="text-slate-400 hover:text-red-500 disabled:opacity-30"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={voegRegelToe}
              className="mt-3 inline-flex items-center gap-1 text-sm text-terracotta-600 hover:text-terracotta-700"
            >
              <Plus size={14} />
              Regel toevoegen
            </button>
          </div>

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
              disabled={create.isPending}
              className="px-4 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50"
            >
              {create.isPending ? 'Aanmaken…' : 'Inkooporder aanmaken'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const inputClasses =
  'px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

function Veld({
  label,
  children,
  full,
}: {
  label: string
  children: React.ReactNode
  full?: boolean
}) {
  return (
    <label className={`text-sm ${full ? 'col-span-2' : ''}`}>
      <span className="block mb-1 text-slate-600">{label}</span>
      {children}
    </label>
  )
}
