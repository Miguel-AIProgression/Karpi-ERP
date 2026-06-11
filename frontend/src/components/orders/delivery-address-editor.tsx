import { useState } from 'react'
import { supabase } from '@/lib/supabase/client'

interface DeliveryAddressEditorProps {
  naam?: string
  adres?: string
  postcode?: string
  plaats?: string
  /** Per-order snapshot van het afleveradres-email (orders.afl_email). */
  aflEmail: string
  /** DB-id van het geselecteerde afleveradressen-record (voor "opslaan als permanent"). */
  afleveradresId?: number
  debiteurNr: number | null
  onEmailChange: (email: string) => void
}

export function DeliveryAddressEditor({
  naam, adres, postcode, plaats,
  aflEmail, afleveradresId, debiteurNr,
  onEmailChange,
}: DeliveryAddressEditorProps) {
  const [editing, setEditing] = useState(false)
  const [draftEmail, setDraftEmail] = useState(aflEmail)
  const [saveToAdres, setSaveToAdres] = useState(!!afleveradresId)
  const [saveToDebiteur, setSaveToDebiteur] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function openEdit() {
    setDraftEmail(aflEmail)
    setSaveToAdres(!!afleveradresId)
    setSaveToDebiteur(false)
    setError(null)
    setEditing(true)
  }

  async function handleApply() {
    setError(null)
    const normEmail = draftEmail.trim()

    if (saving) return
    setSaving(true)
    try {
      if (saveToAdres && afleveradresId) {
        const { error: e } = await supabase
          .from('afleveradressen')
          .update({ email: normEmail || null })
          .eq('id', afleveradresId)
        if (e) throw e
      }
      if (saveToDebiteur && debiteurNr) {
        const { error: e } = await supabase
          .from('debiteuren')
          .update({ email_overig: normEmail || null })
          .eq('debiteur_nr', debiteurNr)
        if (e) throw e
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Opslaan mislukt')
      setSaving(false)
      return
    }
    setSaving(false)
    onEmailChange(normEmail)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="bg-slate-50 rounded-[var(--radius-sm)] p-4">
        <div className="flex items-baseline justify-between mb-1">
          <div className="text-xs font-medium text-slate-500">Afleveradres</div>
          <button
            type="button"
            onClick={openEdit}
            className="text-xs text-terracotta-600 hover:text-terracotta-700"
          >
            E-mail wijzigen
          </button>
        </div>
        <div className="text-sm">
          {naam && <p className="font-medium">{naam}</p>}
          {adres && <p>{adres}</p>}
          <p>{[postcode, plaats].filter(Boolean).join(' ')}</p>
          {aflEmail && (
            <p className="mt-1 text-slate-500 text-xs">{aflEmail}</p>
          )}
          {!aflEmail && (
            <p className="mt-1 text-slate-400 text-xs italic">Geen e-mailadres</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="border border-slate-200 rounded-[var(--radius-sm)] p-3 bg-slate-50 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-600">Afleveradres e-mail wijzigen</p>
        <button
          type="button"
          onClick={() => { setEditing(false); setError(null) }}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          Annuleren
        </button>
      </div>
      <div className="text-sm text-slate-600 mb-1">
        {naam && <span className="font-medium">{naam}</span>}
        {adres && <span className="ml-2 text-slate-400">{adres}, {[postcode, plaats].filter(Boolean).join(' ')}</span>}
      </div>
      <div>
        <label className="block text-[11px] uppercase tracking-wide text-slate-500 mb-0.5">E-mail afleveradres</label>
        <input
          type="email"
          value={draftEmail}
          onChange={(e) => setDraftEmail(e.target.value)}
          className="w-full px-2 py-1.5 rounded-[var(--radius-sm)] border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          placeholder="leveradres@bedrijf.nl"
        />
      </div>
      <div className="space-y-1">
        {afleveradresId && (
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={saveToAdres}
              onChange={(e) => setSaveToAdres(e.target.checked)}
              className="rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400/30"
            />
            Opslaan als vast e-mail voor dit afleveradres
          </label>
        )}
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={saveToDebiteur}
            onChange={(e) => setSaveToDebiteur(e.target.checked)}
            disabled={!debiteurNr}
            className="rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400/30"
          />
          Opslaan als algemeen mailadres op klantpagina
        </label>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <button
        type="button"
        onClick={handleApply}
        disabled={saving}
        className="px-3 py-1.5 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-xs font-medium hover:bg-terracotta-600 disabled:opacity-50"
      >
        {saving ? 'Opslaan…' : 'Toepassen'}
      </button>
    </div>
  )
}
