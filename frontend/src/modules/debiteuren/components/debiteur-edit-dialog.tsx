import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { useActieveBetaalcondities } from '@/hooks/use-betaalcondities'
import type { DebiteurDetail } from '../queries/debiteuren'
import {
  DebiteurFormFields,
  debiteurFormFromDetail,
  debiteurFormToDb,
  valideerDebiteurForm,
  type DebiteurFormValues,
} from './debiteur-form'

interface Props {
  debiteur: DebiteurDetail
  onClose: () => void
}

export function DebiteurEditDialog({ debiteur, onClose }: Props) {
  const qc = useQueryClient()
  const { data: condities } = useActieveBetaalcondities()
  const [form, setForm] = useState<DebiteurFormValues>(() => debiteurFormFromDetail(debiteur))
  const [error, setError] = useState<string | null>(null)

  const onFormChange = (patch: Partial<DebiteurFormValues>) => setForm((f) => ({ ...f, ...patch }))

  const save = useMutation({
    mutationFn: async () => {
      const veldFout = valideerDebiteurForm(form)
      if (veldFout) throw new Error(veldFout)

      const patch = debiteurFormToDb(form, condities ?? [], debiteur.betaalconditie)
      const { error: updErr } = await supabase
        .from('debiteuren')
        .update(patch)
        .eq('debiteur_nr', debiteur.debiteur_nr)
      if (updErr) throw updErr
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['klanten'] })
      qc.invalidateQueries({ queryKey: ['klanten', debiteur.debiteur_nr] })
      onClose()
    },
    onError: (err: unknown) => {
      console.error('[DebiteurEditDialog]', err)
      const e = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown } | null
      const parts = [
        typeof e?.message === 'string' ? e.message : null,
        typeof e?.details === 'string' ? `details: ${e.details}` : null,
        typeof e?.hint === 'string' ? `hint: ${e.hint}` : null,
        typeof e?.code === 'string' ? `code: ${e.code}` : null,
      ].filter(Boolean)
      setError(parts.length > 0 ? parts.join(' — ') : 'Onbekende fout — zie console')
    },
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    save.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="font-medium text-lg">Klant bewerken</h2>
            <p className="text-xs text-slate-400">
              #{debiteur.debiteur_nr} — {debiteur.naam}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 overflow-y-auto">
          {/* Gedeelde veldset (zelfde als bij aanmaken) */}
          <DebiteurFormFields values={form} onChange={onFormChange} />

          <p className="text-xs text-slate-400 pt-2 border-t border-slate-100">
            Vertegenwoordiger, inkoopgroep, verzend-/levertijd-instellingen, logo en (extra) afleveradressen
            beheer je via de eigen knoppen en tabs op de detailpagina.
          </p>

          {error && (
            <div className="px-3 py-2 bg-rose-50 border border-rose-100 text-sm text-rose-700 rounded-[var(--radius-sm)] whitespace-pre-line">
              {error}
            </div>
          )}
        </form>

        <footer className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">
            Annuleren
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={save.isPending}
            className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 disabled:opacity-50"
          >
            {save.isPending ? 'Opslaan...' : 'Opslaan'}
          </button>
        </footer>
      </div>
    </div>
  )
}
