import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useCreateLeverancier, useUpdateLeverancier } from '@/hooks/use-leveranciers'
import type { LeverancierDetail, LeverancierFormData } from '@/lib/supabase/queries/leveranciers'

interface Props {
  leverancier?: LeverancierDetail
  onClose: () => void
}

export function LeverancierFormDialog({ leverancier, onClose }: Props) {
  const isEdit = Boolean(leverancier)
  const [form, setForm] = useState<LeverancierFormData>({
    naam: leverancier?.naam ?? '',
    leverancier_nr: leverancier?.leverancier_nr ?? null,
    woonplaats: leverancier?.woonplaats ?? null,
    adres: leverancier?.adres ?? null,
    postcode: leverancier?.postcode ?? null,
    land: leverancier?.land ?? null,
    contactpersoon: leverancier?.contactpersoon ?? null,
    telefoon: leverancier?.telefoon ?? null,
    email: leverancier?.email ?? null,
    betaalconditie: leverancier?.betaalconditie ?? null,
    actief: leverancier?.actief ?? true,
  })
  const [error, setError] = useState<string | null>(null)

  const create = useCreateLeverancier()
  const update = useUpdateLeverancier()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.naam.trim()) {
      setError('Naam is verplicht')
      return
    }
    try {
      if (isEdit && leverancier) {
        await update.mutateAsync({ id: leverancier.id, data: form })
      } else {
        await create.mutateAsync(form)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Er ging iets mis')
    }
  }

  const set = (k: keyof LeverancierFormData, v: string | number | boolean | null) =>
    setForm((prev) => ({ ...prev, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-medium text-lg">
            {isEdit ? 'Leverancier bewerken' : 'Nieuwe leverancier'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Veld label="Naam *">
              <input
                type="text"
                value={form.naam}
                onChange={(e) => set('naam', e.target.value)}
                className={inputClasses}
                required
              />
            </Veld>
            <Veld label="Leveranciernummer">
              <input
                type="number"
                value={form.leverancier_nr ?? ''}
                onChange={(e) => set('leverancier_nr', e.target.value ? Number(e.target.value) : null)}
                className={inputClasses}
              />
            </Veld>
            <Veld label="Woonplaats">
              <input
                type="text"
                value={form.woonplaats ?? ''}
                onChange={(e) => set('woonplaats', e.target.value || null)}
                className={inputClasses}
              />
            </Veld>
            <Veld label="Land">
              <input
                type="text"
                value={form.land ?? ''}
                onChange={(e) => set('land', e.target.value || null)}
                className={inputClasses}
              />
            </Veld>
            <Veld label="Adres">
              <input
                type="text"
                value={form.adres ?? ''}
                onChange={(e) => set('adres', e.target.value || null)}
                className={inputClasses}
              />
            </Veld>
            <Veld label="Postcode">
              <input
                type="text"
                value={form.postcode ?? ''}
                onChange={(e) => set('postcode', e.target.value || null)}
                className={inputClasses}
              />
            </Veld>
            <Veld label="Contactpersoon">
              <input
                type="text"
                value={form.contactpersoon ?? ''}
                onChange={(e) => set('contactpersoon', e.target.value || null)}
                className={inputClasses}
              />
            </Veld>
            <Veld label="Telefoon">
              <input
                type="text"
                value={form.telefoon ?? ''}
                onChange={(e) => set('telefoon', e.target.value || null)}
                className={inputClasses}
              />
            </Veld>
            <Veld label="Email">
              <input
                type="email"
                value={form.email ?? ''}
                onChange={(e) => set('email', e.target.value || null)}
                className={inputClasses}
              />
            </Veld>
            <Veld label="Betaalconditie">
              <input
                type="text"
                value={form.betaalconditie ?? ''}
                onChange={(e) => set('betaalconditie', e.target.value || null)}
                className={inputClasses}
                placeholder="bijv. 30 dagen netto"
              />
            </Veld>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.actief ?? true}
              onChange={(e) => set('actief', e.target.checked)}
              className="rounded border-slate-300"
            />
            Actief
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
              disabled={create.isPending || update.isPending}
              className="px-4 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50"
            >
              {create.isPending || update.isPending ? 'Opslaan…' : 'Opslaan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

function Veld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-sm">
      <span className="block mb-1 text-slate-600">{label}</span>
      {children}
    </label>
  )
}
