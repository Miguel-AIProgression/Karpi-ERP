import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'
import { useActieveBetaalcondities } from '@/hooks/use-betaalcondities'
import { formatBetaalconditie } from '@/lib/supabase/queries/betaalcondities'

interface Props {
  onClose: () => void
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

type FormState = {
  debiteur_nr: string
  naam: string
  status: string
  adres: string
  postcode: string
  plaats: string
  land: string
  telefoon: string
  email_factuur: string
  btw_nummer: string
  betaalconditie_code: string
}

const initialForm: FormState = {
  debiteur_nr: '',
  naam: '',
  status: 'Actief',
  adres: '',
  postcode: '',
  plaats: '',
  land: 'NL',
  telefoon: '',
  email_factuur: '',
  btw_nummer: '',
  betaalconditie_code: '',
}

export function DebiteurAddDialog({ onClose }: Props) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [form, setForm] = useState<FormState>(initialForm)
  const [error, setError] = useState<string | null>(null)
  const { data: condities } = useActieveBetaalcondities()

  const update = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  const save = useMutation({
    mutationFn: async () => {
      const trimOrNull = (v: string) => {
        const t = v.trim()
        return t === '' ? null : t
      }

      const debiteurNrRaw = form.debiteur_nr.trim()
      if (!debiteurNrRaw) throw new Error('Klantnummer is verplicht')
      const debiteurNr = parseInt(debiteurNrRaw, 10)
      if (isNaN(debiteurNr) || debiteurNr <= 0) throw new Error('Klantnummer moet een positief getal zijn')

      const naam = form.naam.trim()
      if (!naam) throw new Error('Naam is verplicht')

      // Check of het klantnummer al bestaat
      const { data: existing } = await supabase
        .from('debiteuren')
        .select('debiteur_nr')
        .eq('debiteur_nr', debiteurNr)
        .maybeSingle()
      if (existing) throw new Error(`Klantnummer ${debiteurNr} bestaat al`)

      let betaalconditieValue: string | null = null
      if (form.betaalconditie_code) {
        const picked = (condities ?? []).find((c) => c.code === form.betaalconditie_code)
        if (picked) betaalconditieValue = `${picked.code} - ${picked.naam}`
      }

      const { error } = await supabase.from('debiteuren').insert({
        debiteur_nr: debiteurNr,
        naam: naam.toUpperCase(),
        status: form.status,
        adres: trimOrNull(form.adres),
        postcode: trimOrNull(form.postcode),
        plaats: trimOrNull(form.plaats),
        land: trimOrNull(form.land),
        telefoon: trimOrNull(form.telefoon),
        email_factuur: trimOrNull(form.email_factuur),
        btw_nummer: trimOrNull(form.btw_nummer),
        betaalconditie: betaalconditieValue,
      })
      if (error) throw error

      return debiteurNr
    },
    onSuccess: (debiteurNr) => {
      qc.invalidateQueries({ queryKey: ['klanten'] })
      onClose()
      navigate(`/klanten/${debiteurNr}`)
    },
    onError: (err: unknown) => {
      const e = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown } | null
      const parts = [
        typeof e?.message === 'string' ? e.message : null,
        typeof e?.details === 'string' ? `details: ${e.details}` : null,
        typeof e?.hint === 'string' ? `hint: ${e.hint}` : null,
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
            <h2 className="font-medium text-lg">Nieuwe klant toevoegen</h2>
            <p className="text-xs text-slate-400">Vul alle verplichte velden in</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 overflow-y-auto">
          {/* Klantnummer + naam + status */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                Klantnummer <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={form.debiteur_nr}
                onChange={update('debiteur_nr')}
                required
                placeholder="bv. 12345"
                className={inputClasses}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                Naam <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={form.naam}
                onChange={update('naam')}
                required
                placeholder="Bedrijfsnaam"
                className={inputClasses}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Status</label>
              <select value={form.status} onChange={update('status')} className={inputClasses}>
                <option value="Actief">Actief</option>
                <option value="Inactief">Inactief</option>
              </select>
            </div>
          </div>

          {/* Adres */}
          <div className="pt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Adres</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-3">
                <label className="block text-xs text-slate-500 mb-1">Straat + nummer</label>
                <input
                  type="text"
                  value={form.adres}
                  onChange={update('adres')}
                  placeholder="Voorbeeldstraat 1"
                  className={inputClasses}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Postcode</label>
                <input
                  type="text"
                  value={form.postcode}
                  onChange={update('postcode')}
                  placeholder="1234 AB"
                  className={inputClasses}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Plaats</label>
                <input
                  type="text"
                  value={form.plaats}
                  onChange={update('plaats')}
                  placeholder="Amsterdam"
                  className={inputClasses}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Land</label>
                <input
                  type="text"
                  value={form.land}
                  onChange={update('land')}
                  placeholder="NL"
                  className={inputClasses}
                />
              </div>
            </div>
          </div>

          {/* Contact */}
          <div className="pt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Contact</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Telefoon</label>
                <input
                  type="tel"
                  value={form.telefoon}
                  onChange={update('telefoon')}
                  placeholder="+31 20 123 4567"
                  className={inputClasses}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">E-mail factuur</label>
                {/* type="text": één of meerdere adressen (komma-gescheiden) — type="email" weigert meerdere. */}
                <input
                  type="text"
                  value={form.email_factuur}
                  onChange={update('email_factuur')}
                  placeholder="factuur@bedrijf.nl, kopie@bedrijf.nl"
                  className={inputClasses}
                />
              </div>
            </div>
          </div>

          {/* Fiscaal */}
          <div className="pt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Fiscaal &amp; commercieel</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">BTW-nummer</label>
                <input
                  type="text"
                  value={form.btw_nummer}
                  onChange={update('btw_nummer')}
                  placeholder="NL123456789B01"
                  className={inputClasses}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Betaalconditie</label>
                <select
                  value={form.betaalconditie_code}
                  onChange={update('betaalconditie_code')}
                  className={inputClasses}
                >
                  <option value="">— Geen —</option>
                  {(condities ?? []).map((c) => (
                    <option key={c.code} value={c.code}>
                      {formatBetaalconditie(c)}{c.dagen != null ? ` (${c.dagen} dgn)` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {error && (
            <div className="px-3 py-2 bg-rose-50 border border-rose-100 text-sm text-rose-700 rounded-[var(--radius-sm)] whitespace-pre-line">
              {error}
            </div>
          )}
        </form>

        <footer className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
          >
            Annuleren
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={save.isPending}
            className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 disabled:opacity-50"
          >
            {save.isPending ? 'Toevoegen...' : 'Klant toevoegen'}
          </button>
        </footer>
      </div>
    </div>
  )
}
