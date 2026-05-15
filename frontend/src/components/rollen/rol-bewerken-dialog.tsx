import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { rolBewerken } from '@/lib/supabase/queries/rollen'
import type { RolRow, RolStatus } from '@/lib/types/productie'

interface Props {
  rol: RolRow
  onClose: () => void
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

// status-opties zonder gereserveerd/in_snijplan (claim-integriteit, mig 292)
const STATUS_OPTIES = ['beschikbaar', 'reststuk', 'verkocht', 'gesneden'] as const

export function RolBewerkenDialog({ rol, onClose }: Props) {
  const qc = useQueryClient()
  const [lengte, setLengte] = useState(String(rol.lengte_cm))
  const [breedte, setBreedte] = useState(String(rol.breedte_cm))
  const [locatieId, setLocatieId] = useState('')
  const [status, setStatus] = useState(rol.status)
  const [reden, setReden] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: locaties } = useQuery({
    queryKey: ['magazijn-locaties-actief'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('magazijn_locaties')
        .select('id, code, omschrijving')
        .eq('actief', true)
        .order('code')
      if (error) throw error
      return data as { id: number; code: string; omschrijving: string | null }[]
    },
  })

  const l = Number(lengte)
  const b = Number(breedte)
  const oppervlakNa = l > 0 && b > 0 ? (l * b) / 10000 : 0
  const delta = oppervlakNa - Number(rol.oppervlak_m2)

  const save = useMutation({
    mutationFn: async () => {
      if (l <= 0 || b <= 0) throw new Error('Lengte en breedte moeten groter dan 0 zijn')
      if (reden.trim() === '') throw new Error('Reden is verplicht')
      return rolBewerken({
        rol_id: rol.id,
        lengte_cm: l,
        breedte_cm: b,
        locatie_id: locatieId === '' ? null : Number(locatieId),
        status,
        reden: reden.trim(),
        medewerker: null,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['voorraadposities'] })
      onClose()
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Onbekende fout'),
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    save.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-[var(--radius)] w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-medium text-slate-900">Rol bewerken — {rol.rolnummer}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={onSubmit} className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">Lengte (cm)</span>
              <input className={inputClasses} type="number" value={lengte}
                onChange={(e) => setLengte(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Breedte (cm)</span>
              <input className={inputClasses} type="number" value={breedte}
                onChange={(e) => setBreedte(e.target.value)} />
            </label>
          </div>
          <p className="text-xs text-slate-500">
            Oppervlak: <span className="font-medium">{oppervlakNa.toFixed(2)} m²</span>
            {delta !== 0 && (
              <span className={delta > 0 ? 'text-emerald-600' : 'text-red-600'}>
                {' '}({delta > 0 ? '+' : ''}{delta.toFixed(2)} m²)
              </span>
            )}
          </p>
          <label className="block text-sm">
            <span className="text-slate-600">Locatie</span>
            <select className={inputClasses} value={locatieId}
              onChange={(e) => setLocatieId(e.target.value)}>
              <option value="">— ongewijzigd / geen —</option>
              {(locaties ?? []).map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.code}{loc.omschrijving ? ` (${loc.omschrijving})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Status</span>
            <select className={inputClasses} value={status}
              onChange={(e) => setStatus(e.target.value as RolStatus)}>
              {STATUS_OPTIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Reden *</span>
            <input className={inputClasses} value={reden} required
              onChange={(e) => setReden(e.target.value)} />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">
              Annuleren
            </button>
            <button type="submit" disabled={save.isPending}
              className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white hover:bg-terracotta-600 disabled:opacity-50">
              {save.isPending ? 'Bezig…' : 'Opslaan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
