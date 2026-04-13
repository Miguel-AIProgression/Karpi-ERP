import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AFWERKING_OPTIES } from '@/lib/utils/constants'
import { updateRegelAfwerking } from '@/lib/supabase/queries/order-mutations'
import { isAfwerkingEditable } from '@/lib/utils/order-lock'
import type { OrderRegel } from '@/lib/supabase/queries/orders'

interface Props {
  orderId: number
  regels: OrderRegel[]
}

interface RegelState {
  id: number
  afwerking: string
  bandKleur: string
}

export function AfwerkingOnlyEditor({ orderId, regels }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const editableRegels = regels.filter(isAfwerkingEditable)

  const [values, setValues] = useState<RegelState[]>(() =>
    editableRegels.map((r) => ({
      id: r.id,
      afwerking: r.maatwerk_afwerking ?? '',
      bandKleur: r.maatwerk_band_kleur ?? '',
    })),
  )

  const saveMutation = useMutation({
    mutationFn: async () => {
      for (const v of values) {
        if (!v.afwerking) continue
        const needsBand = v.afwerking === 'B' || v.afwerking === 'SB'
        await updateRegelAfwerking(v.id, v.afwerking, needsBand ? (v.bandKleur || null) : null)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['order-regels', orderId] })
      queryClient.invalidateQueries({ queryKey: ['snijplanning'] })
      navigate(`/orders/${orderId}`)
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Opslaan mislukt'),
  })

  const updateValue = (id: number, patch: Partial<RegelState>) => {
    setValues((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)))
  }

  const canSave = values.some((v) => !!v.afwerking)

  return (
    <div className="space-y-6">
      <div className="bg-amber-50 border border-amber-200 rounded-[var(--radius)] p-4 text-sm text-amber-900">
        Deze order is al (deels) gesneden. Alleen afwerking van maatwerk-regels die nog geen afwerking
        hebben, is nog wijzigbaar — totdat de regel ingepakt is.
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-[var(--radius-sm)] p-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-[var(--radius)] border border-slate-200 divide-y divide-slate-100">
        {editableRegels.map((r) => {
          const v = values.find((x) => x.id === r.id)!
          const needsBand = v.afwerking === 'B' || v.afwerking === 'SB'
          return (
            <div key={r.id} className="p-4 space-y-2">
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="font-mono text-xs text-slate-500 mr-2">{r.artikelnr ?? '—'}</span>
                  <span className="text-sm">{r.omschrijving}</span>
                </div>
                <span className="text-xs text-slate-400">
                  {r.maatwerk_lengte_cm && r.maatwerk_breedte_cm
                    ? `${r.maatwerk_lengte_cm}×${r.maatwerk_breedte_cm} cm`
                    : ''}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <span className="text-slate-500">Afwerking</span>
                  <select
                    value={v.afwerking}
                    onChange={(e) => updateValue(r.id, { afwerking: e.target.value })}
                    className="bg-white border border-slate-200 rounded px-2 py-1 text-sm"
                  >
                    <option value="">— kies —</option>
                    {AFWERKING_OPTIES.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} — {a.label}
                      </option>
                    ))}
                  </select>
                </label>

                {needsBand && (
                  <label className="flex items-center gap-2">
                    <span className="text-slate-500">Bandkleur</span>
                    <input
                      type="text"
                      value={v.bandKleur}
                      onChange={(e) => updateValue(r.id, { bandKleur: e.target.value })}
                      placeholder="bijv. zwart"
                      className="bg-white border border-slate-200 rounded px-2 py-1 text-sm w-32"
                    />
                  </label>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={!canSave || saveMutation.isPending}
          className="px-6 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50 transition-colors"
        >
          {saveMutation.isPending ? 'Opslaan...' : 'Afwerking opslaan'}
        </button>
        <button
          type="button"
          onClick={() => navigate(`/orders/${orderId}`)}
          className="px-6 py-2 border border-slate-200 rounded-[var(--radius-sm)] text-sm hover:bg-slate-50"
        >
          Annuleren
        </button>
      </div>
    </div>
  )
}
