import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import type { Afleveradres } from '../queries/debiteuren'

interface Props {
  initial?: Afleveradres
  onSave: (data: Omit<Afleveradres, 'id' | 'adres_nr'> & { id?: number }) => Promise<void>
  onClose: () => void
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

type FormState = {
  naam: string
  adres: string
  postcode: string
  plaats: string
  land: string
  telefoon: string
  email: string
  gln_afleveradres: string
}

const empty: FormState = {
  naam: '',
  adres: '',
  postcode: '',
  plaats: '',
  land: 'Nederland',
  telefoon: '',
  email: '',
  gln_afleveradres: '',
}

export function AfleveradresDialog({ initial, onSave, onClose }: Props) {
  const [form, setForm] = useState<FormState>(
    initial
      ? {
          naam: initial.naam ?? '',
          adres: initial.adres ?? '',
          postcode: initial.postcode ?? '',
          plaats: initial.plaats ?? '',
          land: initial.land ?? 'Nederland',
          telefoon: initial.telefoon ?? '',
          email: initial.email ?? '',
          gln_afleveradres: initial.gln_afleveradres ?? '',
        }
      : empty,
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.naam.trim()) {
      setError('Naam is verplicht')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        id: initial?.id,
        naam: form.naam.trim() || null,
        adres: form.adres.trim() || null,
        postcode: form.postcode.trim() || null,
        plaats: form.plaats.trim() || null,
        land: form.land.trim() || null,
        telefoon: form.telefoon.trim() || null,
        email: form.email.trim() || null,
        gln_afleveradres: form.gln_afleveradres.trim() || null,
      })
      onClose()
    } catch (err) {
      const e = err as { message?: string } | null
      setError(e?.message ?? 'Opslaan mislukt')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">
            {initial ? 'Afleveradres bewerken' : 'Afleveradres toevoegen'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Naam *</label>
            <input className={inputClasses} value={form.naam} onChange={set('naam')} autoFocus />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Adres</label>
            <input className={inputClasses} value={form.adres} onChange={set('adres')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Postcode</label>
              <input className={inputClasses} value={form.postcode} onChange={set('postcode')} />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Plaats</label>
              <input className={inputClasses} value={form.plaats} onChange={set('plaats')} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Land</label>
            <input className={inputClasses} value={form.land} onChange={set('land')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Telefoon</label>
              <input className={inputClasses} value={form.telefoon} onChange={set('telefoon')} type="tel" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">E-mail</label>
              <input className={inputClasses} value={form.email} onChange={set('email')} type="email" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">GLN-afleveradres</label>
            <input className={inputClasses} value={form.gln_afleveradres} onChange={set('gln_afleveradres')} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-[var(--radius-sm)] border border-slate-200 hover:bg-slate-50"
            >
              Annuleren
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white hover:bg-terracotta-600 disabled:opacity-50"
            >
              {saving ? 'Opslaan…' : 'Opslaan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
