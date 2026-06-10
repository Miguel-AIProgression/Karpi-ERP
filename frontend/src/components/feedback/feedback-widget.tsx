import { useState } from 'react'
import { MessageSquarePlus, X, Bug } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useCreateBugMelding } from '@/hooks/use-bug-meldingen'
import type { BugUrgentie } from '@/lib/supabase/queries/bug-meldingen'

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

/**
 * Zwevende feedback/bug-knop rechtsonder, op elke pagina (gerenderd in AppLayout).
 * Legt automatisch de huidige pagina-URL vast; melder komt uit de sessie.
 */
export function FeedbackWidget() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)

  // Alleen tonen voor ingelogde gebruikers (widget hangt buiten de auth-gate niet).
  if (!user) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg transition-colors hover:bg-slate-800"
        title="Feedback of bug melden"
      >
        <MessageSquarePlus size={18} />
        <span className="hidden sm:block">Feedback</span>
      </button>

      {open && <FeedbackDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateBugMelding()
  const [titel, setTitel] = useState('')
  const [omschrijving, setOmschrijving] = useState('')
  const [urgentie, setUrgentie] = useState<BugUrgentie>('Middel')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [klaar, setKlaar] = useState(false)

  const paginaUrl = window.location.href

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!titel.trim()) {
      setError('Geef een korte titel.')
      return
    }
    try {
      await create.mutateAsync({
        titel,
        omschrijving,
        urgentie,
        pagina_url: paginaUrl,
        file,
      })
      setKlaar(true)
      setTimeout(onClose, 1400)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Er ging iets mis bij het versturen.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-[var(--radius)] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Bug size={18} className="text-terracotta-600" /> Feedback / bug melden
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </header>

        {klaar ? (
          <div className="px-6 py-10 text-center">
            <div className="text-2xl">✅</div>
            <p className="mt-2 text-sm font-medium text-slate-700">Bedankt! Je melding is opgeslagen.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Titel <span className="text-rose-500">*</span>
              </label>
              <input
                autoFocus
                value={titel}
                onChange={(e) => setTitel(e.target.value)}
                placeholder="Korte omschrijving van het probleem"
                className={inputClasses}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Omschrijving</label>
              <textarea
                value={omschrijving}
                onChange={(e) => setOmschrijving(e.target.value)}
                rows={4}
                placeholder="Wat gebeurt er, wat verwacht je, en hoe reproduceer je het?"
                className={inputClasses}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Urgentie</label>
                <select
                  value={urgentie}
                  onChange={(e) => setUrgentie(e.target.value as BugUrgentie)}
                  className={inputClasses}
                >
                  <option value="Laag">Laag</option>
                  <option value="Middel">Middel</option>
                  <option value="Hoog">Hoog</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Pagina</label>
                <input value={paginaUrl} readOnly className={`${inputClasses} bg-slate-50 text-slate-500`} />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Schermafbeelding / bijlage
              </label>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-[var(--radius-sm)] file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200"
              />
            </div>

            {error && (
              <div className="rounded-[var(--radius-sm)] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-[var(--radius-sm)] border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Annuleren
              </button>
              <button
                type="submit"
                disabled={create.isPending}
                className="rounded-[var(--radius-sm)] bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {create.isPending ? 'Versturen…' : 'Versturen'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
