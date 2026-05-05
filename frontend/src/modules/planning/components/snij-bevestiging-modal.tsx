import { useState } from 'react'
import { Scissors, X, AlertTriangle } from 'lucide-react'
import { useBatchUpdateSnijplanStatus } from '@/hooks/use-snijplanning'
import type { SnijplanRow } from '@/lib/types/productie'

interface SnijBevestigingModalProps {
  stukken: SnijplanRow[]
  onClose: () => void
  onSuccess: () => void
}

interface RolGroep {
  rolId: number | null
  rolnummer: string | null
  rolLengteCm: number | null
  rolBreedteCm: number | null
  stukken: SnijplanRow[]
}

export function SnijBevestigingModal({ stukken, onClose, onSuccess }: SnijBevestigingModalProps) {
  const batch = useBatchUpdateSnijplanStatus()
  const [error, setError] = useState<string | null>(null)

  // Groepeer per rol
  const rolGroepen: RolGroep[] = []
  const rolMap = new Map<string, RolGroep>()

  for (const s of stukken) {
    const key = s.rol_id != null ? String(s.rol_id) : 'geen_rol'
    if (!rolMap.has(key)) {
      const groep: RolGroep = {
        rolId: s.rol_id,
        rolnummer: s.rolnummer,
        rolLengteCm: s.rol_lengte_cm,
        rolBreedteCm: s.rol_breedte_cm,
        stukken: [],
      }
      rolMap.set(key, groep)
      rolGroepen.push(groep)
    }
    rolMap.get(key)!.stukken.push(s)
  }

  const totalM2 = stukken.reduce((sum, s) => sum + (s.snij_breedte_cm * s.snij_lengte_cm) / 10000, 0)

  function handleBevestig() {
    setError(null)
    const ids = stukken.map(s => s.id)
    batch.mutate(
      { ids, status: 'Gesneden' },
      {
        onSuccess: () => {
          onSuccess()
          onClose()
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'Onbekende fout'),
      },
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Scissors size={18} className="text-emerald-600" />
            <h2 className="font-semibold text-slate-900">Snijden bevestigen</h2>
            <span className="text-sm text-slate-500">— {stukken.length} stuk{stukken.length !== 1 ? 'ken' : ''} · {totalM2.toFixed(2)} m²</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          {rolGroepen.map((groep) => {
            const gebruikteLengte = groep.stukken.reduce((sum, s) => sum + s.snij_lengte_cm, 0)
            const restLengte = groep.rolLengteCm != null ? groep.rolLengteCm - gebruikteLengte : null

            return (
              <div key={groep.rolId ?? 'geen'} className="border border-slate-200 rounded-[var(--radius-sm)] overflow-hidden">
                {/* Rol header */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  <div>
                    <span className="font-medium text-slate-900 text-sm">
                      {groep.rolnummer ?? '— geen rol gekoppeld'}
                    </span>
                    {groep.rolBreedteCm && groep.rolLengteCm && (
                      <span className="ml-2 text-xs text-slate-500">
                        {groep.rolBreedteCm} × {groep.rolLengteCm} cm
                      </span>
                    )}
                  </div>
                  {groep.rolLengteCm != null && (
                    <div className="text-right text-xs">
                      <div className="text-slate-600">
                        Gebruikt: <span className="font-medium text-slate-900">~{gebruikteLengte} cm</span>
                      </div>
                      <div className={restLengte != null && restLengte < 50 ? 'text-amber-600 font-medium' : 'text-emerald-600'}>
                        Resterend: ~{restLengte} cm
                      </div>
                    </div>
                  )}
                </div>

                {/* Stukken tabel */}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase border-b border-slate-100">
                      <th className="text-left px-4 py-2">Maat</th>
                      <th className="text-left px-4 py-2">Klant</th>
                      <th className="text-left px-4 py-2">Order</th>
                      <th className="text-left px-4 py-2">Afwerking</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {groep.stukken.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2 font-medium tabular-nums">
                          {s.snij_breedte_cm}×{s.snij_lengte_cm} cm
                        </td>
                        <td className="px-4 py-2 text-slate-700">{s.klant_naam}</td>
                        <td className="px-4 py-2 text-slate-500">{s.order_nr}</td>
                        <td className="px-4 py-2 text-slate-500">{s.maatwerk_afwerking ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}

          {/* Waarschuwing voor stukken zonder rol */}
          {rolGroepen.some(g => g.rolId == null) && (
            <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] text-xs text-amber-700">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>Sommige stukken hebben geen gekoppelde rol. Ze worden als Gesneden gemarkeerd zonder rolafboeking.</span>
            </div>
          )}

          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-[var(--radius-sm)] text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100">
          <button
            onClick={onClose}
            disabled={batch.isPending}
            className="px-4 py-2 text-sm border border-slate-200 rounded-[var(--radius-sm)] hover:bg-slate-50 transition-colors"
          >
            Annuleren
          </button>
          <button
            onClick={handleBevestig}
            disabled={batch.isPending}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-emerald-600 text-white rounded-[var(--radius-sm)] hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            <Scissors size={15} />
            {batch.isPending ? 'Bezig...' : `Bevestig — ${stukken.length} stuk${stukken.length !== 1 ? 'ken' : ''} gesneden`}
          </button>
        </div>
      </div>
    </div>
  )
}
