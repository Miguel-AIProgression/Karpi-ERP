import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { DebiteurDetail } from '../queries/debiteuren'
import { useActieveBetaalcondities } from '@/hooks/use-betaalcondities'
import { formatBetaalconditie } from '@/lib/supabase/queries/betaalcondities'

interface Props {
  debiteur: DebiteurDetail
  onClose: () => void
}

const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

type FormState = {
  naam: string
  status: string
  adres: string
  postcode: string
  plaats: string
  land: string
  telefoon: string
  email_factuur: string
  email_verzend: string
  btw_nummer: string
  gln_bedrijf: string
  korting_pct: string
  betaalconditie_code: string
}

function extractBetaalconditieCode(raw: string | null): string {
  if (!raw) return ''
  const m = raw.match(/^\s*([^\s-][^-]*?)\s*-/)
  return m ? m[1].trim() : ''
}

const toForm = (k: DebiteurDetail): FormState => ({
  naam: k.naam ?? '',
  status: k.status ?? 'Actief',
  adres: k.adres ?? '',
  postcode: k.postcode ?? '',
  plaats: k.plaats ?? '',
  land: k.land ?? '',
  telefoon: k.telefoon ?? '',
  email_factuur: k.email_factuur ?? '',
  email_verzend: k.email_verzend ?? '',
  btw_nummer: k.btw_nummer ?? '',
  gln_bedrijf: k.gln_bedrijf ?? '',
  korting_pct: k.korting_pct != null ? String(k.korting_pct) : '',
  betaalconditie_code: extractBetaalconditieCode(k.betaalconditie),
})

export function DebiteurEditDialog({ debiteur, onClose }: Props) {
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(toForm(debiteur))
  const [error, setError] = useState<string | null>(null)
  const { data: condities } = useActieveBetaalcondities()

  const currentCode = form.betaalconditie_code
  const knownCodes = new Set((condities ?? []).map((c) => c.code))
  const hasOrphanCurrent = currentCode !== '' && !knownCodes.has(currentCode)

  const update = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  const save = useMutation({
    mutationFn: async () => {
      const trimOrNull = (v: string) => {
        const t = v.trim()
        return t === '' ? null : t
      }
      const naam = form.naam.trim()
      if (!naam) throw new Error('Naam is verplicht')

      const kortingNum = form.korting_pct.trim() === '' ? 0 : Number(form.korting_pct.replace(',', '.'))
      if (Number.isNaN(kortingNum) || kortingNum < 0 || kortingNum > 100) {
        throw new Error('Korting moet tussen 0 en 100 liggen')
      }

      let betaalconditieValue: string | null = debiteur.betaalconditie ?? null
      if (form.betaalconditie_code === '') {
        betaalconditieValue = null
      } else if (form.betaalconditie_code !== extractBetaalconditieCode(debiteur.betaalconditie)) {
        const picked = (condities ?? []).find((c) => c.code === form.betaalconditie_code)
        if (picked) betaalconditieValue = `${picked.code} - ${picked.naam}`
      }

      const patch = {
        naam,
        status: form.status,
        adres: trimOrNull(form.adres),
        postcode: trimOrNull(form.postcode),
        plaats: trimOrNull(form.plaats),
        land: trimOrNull(form.land),
        telefoon: trimOrNull(form.telefoon),
        email_factuur: trimOrNull(form.email_factuur),
        email_verzend: trimOrNull(form.email_verzend),
        btw_nummer: trimOrNull(form.btw_nummer),
        gln_bedrijf: trimOrNull(form.gln_bedrijf),
        korting_pct: kortingNum,
        betaalconditie: betaalconditieValue,
      }

      const { error } = await supabase
        .from('debiteuren')
        .update(patch)
        .eq('debiteur_nr', debiteur.debiteur_nr)
      if (error) throw error
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
            <p className="text-xs text-slate-400">#{debiteur.debiteur_nr} — {debiteur.naam}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-slate-500 mb-1">Naam <span className="text-rose-500">*</span></label>
              <input type="text" value={form.naam} onChange={update('naam')} required className={inputClasses} />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Status</label>
              <select value={form.status} onChange={update('status')} className={inputClasses}>
                <option value="Actief">Actief</option>
                <option value="Inactief">Inactief</option>
              </select>
            </div>
          </div>

          <div className="pt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Adres</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-3">
                <label className="block text-xs text-slate-500 mb-1">Straat + nummer</label>
                <input type="text" value={form.adres} onChange={update('adres')} className={inputClasses} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Postcode</label>
                <input type="text" value={form.postcode} onChange={update('postcode')} className={inputClasses} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Plaats</label>
                <input type="text" value={form.plaats} onChange={update('plaats')} className={inputClasses} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Land</label>
                <input type="text" value={form.land} onChange={update('land')} className={inputClasses} />
              </div>
            </div>
          </div>

          <div className="pt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Contact</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Telefoon</label>
                <input type="tel" value={form.telefoon} onChange={update('telefoon')} className={inputClasses} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">E-mail factuur</label>
                {/* type="text": één of meerdere adressen (komma-gescheiden) — type="email" weigert meerdere. */}
                <input type="text" value={form.email_factuur} onChange={update('email_factuur')} placeholder="factuur@klant.nl, kopie@klant.nl" className={inputClasses} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-500 mb-1">E-mail verzending (track &amp; trace)</label>
                <input type="email" value={form.email_verzend} onChange={update('email_verzend')} placeholder="magazijn@klant.nl" className={inputClasses} />
                <p className="text-xs text-slate-400 mt-1">
                  Standaard T&amp;T-adres voor nieuwe orders. Leeg = algemeen e-mailadres wordt gebruikt.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Fiscaal &amp; commercieel</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">BTW-nummer</label>
                <input type="text" value={form.btw_nummer} onChange={update('btw_nummer')} className={inputClasses} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">GLN moederbedrijf</label>
                <input type="text" value={form.gln_bedrijf} onChange={update('gln_bedrijf')} className={inputClasses} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Korting (%)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={form.korting_pct}
                  onChange={update('korting_pct')}
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
                  {hasOrphanCurrent && (
                    <option value={currentCode}>
                      {debiteur.betaalconditie} (niet in lijst)
                    </option>
                  )}
                  {(condities ?? []).map((c) => (
                    <option key={c.code} value={c.code}>
                      {formatBetaalconditie(c)}{c.dagen != null ? ` (${c.dagen} dgn)` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  Beheer de lijst via <code className="px-1 mx-0.5 bg-slate-100 rounded">Instellingen → Betaalcondities</code>.
                </p>
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-400 pt-2 border-t border-slate-100">
            Prijslijst, vertegenwoordiger, inkoopgroep, factuuradres en verzend-/levertijd-instellingen
            beheer je via de eigen knoppen op de detailpagina.
          </p>

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
            {save.isPending ? 'Opslaan...' : 'Opslaan'}
          </button>
        </footer>
      </div>
    </div>
  )
}
