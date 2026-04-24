import { useState, type FormEvent } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { useBoekOntvangst } from '@/hooks/use-inkooporders'
import type { InkooporderRegel, OntvangstRol } from '@/lib/supabase/queries/inkooporders'

interface Props {
  regel: InkooporderRegel
  inkooporderNr: string
  onClose: () => void
}

interface RolInput {
  rolnummer: string
  lengte_cm: string
  breedte_cm: string
}

function formatAantal(value: number): string {
  return value.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
}

export function OntvangstBoekenDialog({ regel, inkooporderNr, onClose }: Props) {
  const [rollen, setRollen] = useState<RolInput[]>([
    { rolnummer: '', lengte_cm: '', breedte_cm: '' },
  ])
  const [medewerker, setMedewerker] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [toegekend, setToegekend] = useState<Array<{ rol_id: number; rolnummer: string }> | null>(null)

  const boek = useBoekOntvangst()

  const totaalM2 = rollen.reduce((s, r) => {
    const l = Number(r.lengte_cm)
    const b = Number(r.breedte_cm)
    if (!Number.isFinite(l) || !Number.isFinite(b)) return s
    return s + (l * b) / 10000
  }, 0)

  const voegRolToe = () =>
    setRollen((prev) => [...prev, { rolnummer: '', lengte_cm: '', breedte_cm: '' }])

  const verwijderRol = (idx: number) =>
    setRollen((prev) => prev.filter((_, i) => i !== idx))

  const wijzigRol = (idx: number, veld: keyof RolInput, waarde: string) =>
    setRollen((prev) => prev.map((r, i) => (i === idx ? { ...r, [veld]: waarde } : r)))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    const payload: OntvangstRol[] = []
    for (const [i, r] of rollen.entries()) {
      const lengte = Number(r.lengte_cm)
      const breedte = Number(r.breedte_cm)
      if (!Number.isFinite(lengte) || lengte <= 0) {
        setError(`Rol ${i + 1}: ongeldige lengte (cm)`)
        return
      }
      if (!Number.isFinite(breedte) || breedte <= 0) {
        setError(`Rol ${i + 1}: ongeldige breedte (cm)`)
        return
      }
      payload.push({
        rolnummer: r.rolnummer.trim() || null,
        lengte_cm: lengte,
        breedte_cm: breedte,
      })
    }

    try {
      const result = await boek.mutateAsync({
        regelId: regel.id,
        rollen: payload,
        medewerker: medewerker || undefined,
      })
      setToegekend(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ontvangst boeken mislukt')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="font-medium text-lg">Ontvangst boeken</h2>
            <p className="text-sm text-slate-500">
              {inkooporderNr} · regel {regel.regelnummer} · {regel.karpi_code ?? regel.artikelnr ?? '-'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        {toegekend ? (
          <div className="px-6 py-6 space-y-4">
            <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-[var(--radius-sm)] px-3 py-2">
              {toegekend.length} rol{toegekend.length === 1 ? '' : 'len'} toegevoegd aan voorraad.
            </div>
            <div>
              <h3 className="font-medium text-sm mb-2">Toegekende rolnummers</h3>
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-[var(--radius-sm)]">
                {toegekend.map((t) => (
                  <li key={t.rol_id} className="px-3 py-2 flex items-center justify-between text-sm">
                    <span className="font-mono text-slate-800">{t.rolnummer}</span>
                    <span className="text-xs text-slate-400">id {t.rol_id}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-500 mt-2">
                Noteer of print deze nummers voor de fysieke rollen.
              </p>
            </div>
            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600"
              >
                Sluiten
              </button>
            </div>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 rounded-[var(--radius-sm)] text-sm">
            <div>
              <span className="text-slate-500">Besteld</span>
              <p className="font-medium">{formatAantal(regel.besteld_m)} m²</p>
            </div>
            <div>
              <span className="text-slate-500">Al geleverd</span>
              <p className="font-medium">{formatAantal(regel.geleverd_m)} m²</p>
            </div>
            <div>
              <span className="text-slate-500">Nog te leveren</span>
              <p className="font-medium text-slate-800">{formatAantal(regel.te_leveren_m)} m²</p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-sm">Rollen die binnenkomen</h3>
              <span className="text-sm text-slate-500">
                Totaal nu: <strong>{formatAantal(totaalM2)} m²</strong>
              </span>
            </div>

            <div className="space-y-2">
              {rollen.map((r, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-6 text-sm text-slate-400">{idx + 1}.</span>
                  <input
                    type="text"
                    value={r.rolnummer}
                    onChange={(e) => wijzigRol(idx, 'rolnummer', e.target.value)}
                    placeholder="Rolnummer (leeg = auto R-YYYY-NNNN)"
                    className={`flex-1 ${inputClasses}`}
                  />
                  <input
                    type="number"
                    value={r.lengte_cm}
                    onChange={(e) => wijzigRol(idx, 'lengte_cm', e.target.value)}
                    placeholder="Lengte (cm)"
                    className={`w-32 ${inputClasses}`}
                    min="1"
                    required
                  />
                  <input
                    type="number"
                    value={r.breedte_cm}
                    onChange={(e) => wijzigRol(idx, 'breedte_cm', e.target.value)}
                    placeholder="Breedte (cm)"
                    className={`w-32 ${inputClasses}`}
                    min="1"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => verwijderRol(idx)}
                    disabled={rollen.length === 1}
                    className="text-slate-400 hover:text-red-500 disabled:opacity-30"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={voegRolToe}
              className="mt-3 inline-flex items-center gap-1 text-sm text-terracotta-600 hover:text-terracotta-700"
            >
              <Plus size={14} />
              Extra rol toevoegen
            </button>
          </div>

          <label className="text-sm block">
            <span className="block mb-1 text-slate-600">Medewerker (optioneel)</span>
            <input
              type="text"
              value={medewerker}
              onChange={(e) => setMedewerker(e.target.value)}
              className={`w-64 ${inputClasses}`}
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
              {boek.isPending ? 'Bezig…' : `Boek ${rollen.length} rol${rollen.length === 1 ? '' : 'len'}`}
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  )
}

const inputClasses =
  'px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'
