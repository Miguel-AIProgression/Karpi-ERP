import { useState, type FormEvent } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { rolVerwijderen } from '@/lib/supabase/queries/rollen'
import type { RolRow } from '@/lib/types/productie'

interface Props {
  rol: RolRow
  onClose: () => void
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-400/30 focus:border-red-400'

export function RolVerwijderenDialog({ rol, onClose }: Props) {
  const qc = useQueryClient()
  const [reden, setReden] = useState('')
  const [error, setError] = useState<string | null>(null)

  const verwijder = useMutation({
    mutationFn: async () => {
      if (reden.trim() === '') throw new Error('Reden is verplicht')
      return rolVerwijderen({ rol_id: rol.id, reden: reden.trim(), medewerker: null })
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
    verwijder.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-[var(--radius)] w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-medium text-slate-900">Rol verwijderen</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={onSubmit} className="px-5 py-4 space-y-3">
          <div className="flex items-start gap-2 text-sm text-slate-600">
            <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <p>
              Rol <span className="font-mono">{rol.rolnummer}</span>{' '}
              ({Number(rol.oppervlak_m2).toFixed(2)} m²) wordt definitief verwijderd.
              De voorraad op deze pagina daalt direct met dit oppervlak.
            </p>
          </div>
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
            <button type="submit" disabled={verwijder.isPending}
              className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
              {verwijder.isPending ? 'Bezig…' : 'Verwijderen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
