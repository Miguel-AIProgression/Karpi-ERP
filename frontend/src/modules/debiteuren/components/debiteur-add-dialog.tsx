import { useEffect, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'
import { useActieveBetaalcondities } from '@/hooks/use-betaalcondities'
import { saveAfleveradres, volgendDebiteurNr } from '../queries/debiteuren'
import {
  DebiteurFormFields,
  debiteurFormToDb,
  emptyDebiteurForm,
  inputClasses,
  valideerDebiteurForm,
  type DebiteurFormValues,
} from './debiteur-form'

interface Props {
  onClose: () => void
}

type AfleveradresState = {
  naam: string
  adres: string
  postcode: string
  plaats: string
  land: string
  telefoon: string
  email: string
  gln_afleveradres: string
}

const emptyAfleveradres: AfleveradresState = {
  naam: '',
  adres: '',
  postcode: '',
  plaats: '',
  land: 'NL',
  telefoon: '',
  email: '',
  gln_afleveradres: '',
}

export function DebiteurAddDialog({ onClose }: Props) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: condities } = useActieveBetaalcondities()

  const [form, setForm] = useState<DebiteurFormValues>(emptyDebiteurForm)
  const [debiteurNr, setDebiteurNr] = useState('')
  const [nrTouched, setNrTouched] = useState(false)
  const [afwijkendAfleveradres, setAfwijkendAfleveradres] = useState(false)
  const [afl, setAfl] = useState<AfleveradresState>(emptyAfleveradres)
  const [error, setError] = useState<string | null>(null)

  // Klantnummer-voorstel = hoogste bestaande + 1 (999xxx-placeholders uitgesloten).
  const { data: voorstelNr } = useQuery({
    queryKey: ['volgend-debiteur-nr'],
    queryFn: volgendDebiteurNr,
  })
  useEffect(() => {
    if (!nrTouched && debiteurNr === '' && voorstelNr != null) {
      setDebiteurNr(String(voorstelNr))
    }
  }, [voorstelNr, nrTouched, debiteurNr])

  const onFormChange = (patch: Partial<DebiteurFormValues>) => setForm((f) => ({ ...f, ...patch }))
  const setAflField =
    (key: keyof AfleveradresState) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setAfl((a) => ({ ...a, [key]: e.target.value }))

  const save = useMutation({
    mutationFn: async () => {
      const veldFout = valideerDebiteurForm(form)
      if (veldFout) throw new Error(veldFout)

      const nrRaw = debiteurNr.trim()
      if (!nrRaw) throw new Error('Klantnummer is verplicht')
      const nr = parseInt(nrRaw, 10)
      if (Number.isNaN(nr) || nr <= 0) throw new Error('Klantnummer moet een positief getal zijn')

      const { data: existing } = await supabase
        .from('debiteuren')
        .select('debiteur_nr')
        .eq('debiteur_nr', nr)
        .maybeSingle()
      if (existing) throw new Error(`Klantnummer ${nr} bestaat al`)

      const { error: insErr } = await supabase
        .from('debiteuren')
        .insert({ debiteur_nr: nr, ...debiteurFormToDb(form, condities ?? []) })
      if (insErr) throw insErr

      // Optioneel: één primair afleveradres dat afwijkt van het hoofdadres.
      if (afwijkendAfleveradres && afl.naam.trim()) {
        await saveAfleveradres(nr, {
          naam: afl.naam.trim() || null,
          adres: afl.adres.trim() || null,
          postcode: afl.postcode.trim() || null,
          plaats: afl.plaats.trim() || null,
          land: afl.land.trim() || null,
          telefoon: afl.telefoon.trim() || null,
          email: afl.email.trim() || null,
          gln_afleveradres: afl.gln_afleveradres.trim() || null,
        })
      }

      return nr
    },
    onSuccess: (nr) => {
      qc.invalidateQueries({ queryKey: ['klanten'] })
      onClose()
      navigate(`/klanten/${nr}`)
    },
    onError: (err: unknown) => {
      const e = err as { message?: unknown; details?: unknown; hint?: unknown } | null
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
            <p className="text-xs text-slate-400">Vul de gegevens in — verplicht: klantnummer en naam</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 overflow-y-auto">
          {/* Klantnummer (auto-voorstel) */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                Klantnummer <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={debiteurNr}
                onChange={(e) => {
                  setNrTouched(true)
                  setDebiteurNr(e.target.value)
                }}
                required
                placeholder="bv. 12345"
                className={inputClasses}
              />
              <p className="text-xs text-slate-400 mt-1">Voorstel = hoogste bestaande nummer + 1. Aanpasbaar.</p>
            </div>
          </div>

          {/* Gedeelde veldset (zelfde als bij bewerken) */}
          <DebiteurFormFields values={form} onChange={onFormChange} />

          {/* Optioneel afwijkend primair afleveradres */}
          <div className="pt-2 border-t border-slate-100">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={afwijkendAfleveradres}
                onChange={(e) => setAfwijkendAfleveradres(e.currentTarget.checked)}
                className="h-4 w-4 rounded border-slate-300 accent-terracotta-500"
              />
              <span>Afleveradres wijkt af van het hoofdadres</span>
            </label>
            <p className="text-xs text-slate-400 mt-1">
              Laat uit als de klant op het hoofdadres geleverd krijgt. Extra afleveradressen voeg je later toe
              op de klantpagina (tab Afleveradressen).
            </p>

            {afwijkendAfleveradres && (
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div className="col-span-3">
                  <label className="block text-xs text-slate-500 mb-1">Naam</label>
                  <input type="text" value={afl.naam} onChange={setAflField('naam')} className={inputClasses} />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs text-slate-500 mb-1">Straat + nummer</label>
                  <input type="text" value={afl.adres} onChange={setAflField('adres')} className={inputClasses} />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Postcode</label>
                  <input type="text" value={afl.postcode} onChange={setAflField('postcode')} className={inputClasses} />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Plaats</label>
                  <input type="text" value={afl.plaats} onChange={setAflField('plaats')} className={inputClasses} />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Land</label>
                  <input type="text" value={afl.land} onChange={setAflField('land')} className={inputClasses} />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Telefoon</label>
                  <input type="tel" value={afl.telefoon} onChange={setAflField('telefoon')} className={inputClasses} />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">E-mail (T&amp;T)</label>
                  <input type="text" value={afl.email} onChange={setAflField('email')} className={inputClasses} />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">GLN-afleveradres</label>
                  <input type="text" value={afl.gln_afleveradres} onChange={setAflField('gln_afleveradres')} className={inputClasses} />
                </div>
              </div>
            )}
          </div>

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
            {save.isPending ? 'Toevoegen...' : 'Klant toevoegen'}
          </button>
        </footer>
      </div>
    </div>
  )
}
