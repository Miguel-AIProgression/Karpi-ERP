import { useState, type FormEvent } from 'react'
import { Plus, Printer, Trash2, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useBoekOntvangst } from '@/hooks/use-inkooporders'
import { useAuth } from '@/hooks/use-auth'
import {
  fetchRollenVoorArtikel,
  type InkooporderRegel,
  type OntvangstRol,
} from '@/lib/supabase/queries/inkooporders'

interface Props {
  regel: InkooporderRegel
  inkooporderNr: string
  breedteCm?: number | null
  onClose: () => void
}

interface RolInput {
  strekkende_m: string
  breedte_cm_manueel: string
}

function formatAantal(value: number): string {
  return value.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
}

export function OntvangstBoekenDialog({ regel, inkooporderNr, breedteCm, onClose }: Props) {
  const { user } = useAuth()
  const medewerker =
    (user?.user_metadata?.name as string | undefined) ?? user?.email ?? null

  const breedteBekend = breedteCm != null && breedteCm > 0
  const [rollen, setRollen] = useState<RolInput[]>([
    { strekkende_m: '', breedte_cm_manueel: '' },
  ])
  const [error, setError] = useState<string | null>(null)
  const [toegekend, setToegekend] = useState<Array<{ rol_id: number; rolnummer: string }> | null>(null)

  const { data: huidigeRollen = [], isLoading: rollenLaden } = useQuery({
    queryKey: ['rollen-voor-artikel', regel.artikelnr],
    queryFn: () => fetchRollenVoorArtikel(regel.artikelnr!),
    enabled: !!regel.artikelnr,
  })

  const boek = useBoekOntvangst()

  const breedteVoorRol = (r: RolInput): number | null => {
    if (breedteBekend) return breedteCm as number
    const b = Number(r.breedte_cm_manueel)
    return Number.isFinite(b) && b > 0 ? b : null
  }

  const totaalM2 = rollen.reduce((s, r) => {
    const l = Number(r.strekkende_m)
    const b = breedteVoorRol(r)
    if (!Number.isFinite(l) || l <= 0 || b == null) return s
    return s + l * (b / 100)
  }, 0)

  const voegRolToe = () =>
    setRollen((prev) => [...prev, { strekkende_m: '', breedte_cm_manueel: '' }])

  const verwijderRol = (idx: number) =>
    setRollen((prev) => prev.filter((_, i) => i !== idx))

  const wijzigRol = (idx: number, veld: keyof RolInput, waarde: string) =>
    setRollen((prev) => prev.map((r, i) => (i === idx ? { ...r, [veld]: waarde } : r)))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    const payload: OntvangstRol[] = []
    for (const [i, r] of rollen.entries()) {
      const strekkende = Number(r.strekkende_m)
      if (!Number.isFinite(strekkende) || strekkende <= 0) {
        setError(`Rol ${i + 1}: ongeldige lengte (m)`)
        return
      }
      const breedte = breedteVoorRol(r)
      if (breedte == null) {
        setError(`Rol ${i + 1}: breedte (cm) ontbreekt`)
        return
      }
      payload.push({
        lengte_cm: Math.round(strekkende * 100),
        breedte_cm: breedte,
      })
    }

    try {
      const result = await boek.mutateAsync({
        regelId: regel.id,
        rollen: payload,
        medewerker: medewerker ?? undefined,
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
            <div className="flex justify-between items-center pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  const ids = toegekend.map((t) => t.rol_id).join(',')
                  window.open(`/rollen/stickers?ids=${ids}`, '_blank', 'noopener,noreferrer')
                }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-emerald-700"
              >
                <Printer size={14} />
                Stickers printen
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
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
              <h3 className="font-medium text-sm">
                Rollen die binnenkomen
                {breedteBekend && (
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    breedte: {breedteCm} cm
                  </span>
                )}
              </h3>
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
                  <div className="relative w-40">
                    <input
                      type="number"
                      value={r.strekkende_m}
                      onChange={(e) => wijzigRol(idx, 'strekkende_m', e.target.value)}
                      placeholder="Lengte"
                      className={`w-full pr-8 ${inputClasses}`}
                      step="0.01"
                      min="0.01"
                      required
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">
                      m
                    </span>
                  </div>
                  {!breedteBekend && (
                    <input
                      type="number"
                      value={r.breedte_cm_manueel}
                      onChange={(e) => wijzigRol(idx, 'breedte_cm_manueel', e.target.value)}
                      placeholder="Breedte (cm)"
                      className={`w-32 ${inputClasses}`}
                      min="1"
                      required
                    />
                  )}
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

          <div>
            <h3 className="font-medium text-sm mb-2">
              Huidige voorraad
              <span className="ml-2 text-xs font-normal text-slate-400">
                {regel.karpi_code ?? regel.artikelnr ?? '-'}
              </span>
            </h3>
            {rollenLaden ? (
              <p className="text-xs text-slate-400">Rollen laden…</p>
            ) : huidigeRollen.length === 0 ? (
              <p className="text-xs text-slate-400">Geen bestaande rollen in voorraad.</p>
            ) : (
              <div className="border border-slate-200 rounded-[var(--radius-sm)] max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-1.5 font-medium">Rolnummer</th>
                      <th className="text-right px-3 py-1.5 font-medium">Lengte</th>
                      <th className="text-right px-3 py-1.5 font-medium">Breedte</th>
                      <th className="text-right px-3 py-1.5 font-medium">m²</th>
                      <th className="text-left px-3 py-1.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {huidigeRollen.map((h) => (
                      <tr key={h.id}>
                        <td className="px-3 py-1 font-mono text-slate-700">{h.rolnummer}</td>
                        <td className="px-3 py-1 text-right tabular-nums">
                          {h.lengte_cm != null ? `${(h.lengte_cm / 100).toFixed(2)} m` : '-'}
                        </td>
                        <td className="px-3 py-1 text-right tabular-nums">
                          {h.breedte_cm != null ? `${h.breedte_cm} cm` : '-'}
                        </td>
                        <td className="px-3 py-1 text-right tabular-nums">
                          {h.oppervlak_m2 != null ? formatAantal(Number(h.oppervlak_m2)) : '-'}
                        </td>
                        <td className="px-3 py-1 text-slate-500">{h.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
