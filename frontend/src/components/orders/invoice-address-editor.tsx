import { useState } from 'react'
import { supabase } from '@/lib/supabase/client'

export interface FactuurAdres {
  naam: string
  adres: string
  postcode: string
  plaats: string
  land: string
}

export interface FactuurContact {
  email_factuur: string
  email_overig: string
  email_pakbon: string
}

interface InvoiceAddressEditorProps {
  debiteurNr: number | null
  currentAdres: FactuurAdres
  currentContact: FactuurContact
  /** Per-order snapshot van het factuuradres-email (mig 364). */
  factEmail: string
  onAdresChange: (addr: FactuurAdres) => void
  onEmailChange: (email: string) => void
  onSavedAsDefault?: (addr: FactuurAdres, contact: FactuurContact) => void
}

export function InvoiceAddressEditor({
  debiteurNr,
  currentAdres,
  currentContact,
  factEmail,
  onAdresChange,
  onEmailChange,
  onSavedAsDefault,
}: InvoiceAddressEditorProps) {
  const [editing, setEditing] = useState(false)
  const [draftAdres, setDraftAdres] = useState<FactuurAdres>(currentAdres)
  const [draftEmail, setDraftEmail] = useState(factEmail)
  const [draftEmailOverig, setDraftEmailOverig] = useState(currentContact.email_overig)
  const [draftEmailPakbon, setDraftEmailPakbon] = useState(currentContact.email_pakbon)
  const [saveEmail, setSaveEmail] = useState(true)
  const [saveEmailOverig, setSaveEmailOverig] = useState(true)
  const [saveEmailPakbon, setSaveEmailPakbon] = useState(true)
  const [persist, setPersist] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function openEdit() {
    setDraftAdres(currentAdres)
    setDraftEmail(factEmail)
    setDraftEmailOverig(currentContact.email_overig)
    setDraftEmailPakbon(currentContact.email_pakbon)
    setSaveEmail(true)
    setSaveEmailOverig(true)
    setSaveEmailPakbon(true)
    setPersist(true)
    setError(null)
    setEditing(true)
  }

  async function handleApply() {
    if (!draftAdres.naam.trim() || !draftAdres.adres.trim() || !draftAdres.plaats.trim()) {
      setError('Naam, adres en plaats zijn verplicht')
      return
    }
    setError(null)

    const normAdres: FactuurAdres = {
      naam: draftAdres.naam.trim(),
      adres: draftAdres.adres.trim(),
      postcode: draftAdres.postcode.trim(),
      plaats: draftAdres.plaats.trim(),
      land: draftAdres.land.trim() || 'NL',
    }
    const normEmail = draftEmail.trim()

    const normEmailOverig = draftEmailOverig.trim()
    const normEmailPakbon = draftEmailPakbon.trim()

    if (persist && debiteurNr) {
      setSaving(true)
      const update: Record<string, unknown> = {
        fact_naam: normAdres.naam,
        fact_adres: normAdres.adres,
        fact_postcode: normAdres.postcode || null,
        fact_plaats: normAdres.plaats,
      }
      if (saveEmail) update.email_factuur = normEmail || null
      if (saveEmailOverig) update.email_overig = normEmailOverig || null
      if (saveEmailPakbon) update.email_pakbon = normEmailPakbon || null
      const { error: updErr } = await supabase
        .from('debiteuren')
        .update(update)
        .eq('debiteur_nr', debiteurNr)
      setSaving(false)
      if (updErr) {
        setError(updErr.message || 'Opslaan op klantpagina mislukt')
        return
      }
      onSavedAsDefault?.(normAdres, {
        email_factuur: saveEmail ? normEmail : currentContact.email_factuur,
        email_overig: saveEmailOverig ? normEmailOverig : currentContact.email_overig,
        email_pakbon: saveEmailPakbon ? normEmailPakbon : currentContact.email_pakbon,
      })
    }

    onAdresChange(normAdres)
    onEmailChange(normEmail)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="bg-slate-50 rounded-[var(--radius-sm)] p-4">
        <div className="flex items-baseline justify-between mb-1">
          <div className="text-xs font-medium text-slate-500">Factuuradres</div>
          <button
            type="button"
            onClick={openEdit}
            className="text-xs text-terracotta-600 hover:text-terracotta-700"
          >
            Wijzig
          </button>
        </div>
        <div className="text-sm">
          {currentAdres.naam && <p className="font-medium">{currentAdres.naam}</p>}
          {currentAdres.adres && <p>{currentAdres.adres}</p>}
          <p>{[currentAdres.postcode, currentAdres.plaats].filter(Boolean).join(' ')}</p>
          <div className="mt-1.5 pt-1.5 border-t border-slate-200 space-y-0.5">
            {factEmail ? (
              <p className="text-xs text-slate-500">
                <span className="text-slate-400">Factuur/pakbon: </span>{factEmail}
              </p>
            ) : (
              <p className="text-xs text-amber-600 font-medium">Factuur/pakbon: ontbreekt — vereist</p>
            )}
            {currentContact.email_pakbon && (
              <p className="text-xs text-slate-500">
                <span className="text-slate-400">Pakbon: </span>{currentContact.email_pakbon}
              </p>
            )}
            {currentContact.email_overig ? (
              <p className="text-xs text-slate-500">
                <span className="text-slate-400">Orderbevestiging: </span>{currentContact.email_overig}
              </p>
            ) : (
              <p className="text-xs text-amber-600 font-medium">Orderbevestiging: ontbreekt — vereist</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="border border-slate-200 rounded-[var(--radius-sm)] p-3 bg-slate-50 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-600">Factuuradres wijzigen</p>
        <button
          type="button"
          onClick={() => { setEditing(false); setError(null) }}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          Annuleren
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <ManualField label="Naam" value={draftAdres.naam} onChange={(v) => setDraftAdres(d => ({ ...d, naam: v }))} />
        <ManualField label="Adres" value={draftAdres.adres} onChange={(v) => setDraftAdres(d => ({ ...d, adres: v }))} />
        <ManualField label="Postcode" value={draftAdres.postcode} onChange={(v) => setDraftAdres(d => ({ ...d, postcode: v }))} />
        <ManualField label="Plaats" value={draftAdres.plaats} onChange={(v) => setDraftAdres(d => ({ ...d, plaats: v }))} />
        <ManualField label="Land" value={draftAdres.land} onChange={(v) => setDraftAdres(d => ({ ...d, land: v }))} />
      </div>
      <div className="pt-2 mt-2 border-t border-slate-200 space-y-2">
        <ManualField
          label="E-mail factuur (vereist)"
          type="email"
          value={draftEmail}
          onChange={setDraftEmail}
        />
        <label className="inline-flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={saveEmail}
            onChange={(e) => setSaveEmail(e.target.checked)}
            className="rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400/30"
            disabled={!debiteurNr || !persist}
          />
          Opslaan als vast factuurmailadres op klantpagina
        </label>
        <ManualField
          label="E-mail pakbon (optioneel — apart adres)"
          type="email"
          value={draftEmailPakbon}
          onChange={setDraftEmailPakbon}
        />
        <label className="inline-flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={saveEmailPakbon}
            onChange={(e) => setSaveEmailPakbon(e.target.checked)}
            className="rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400/30"
            disabled={!debiteurNr || !persist}
          />
          Opslaan als vast pakbon-mailadres op klantpagina
        </label>
        <ManualField
          label="E-mail orderbevestiging (vereist)"
          type="email"
          value={draftEmailOverig}
          onChange={setDraftEmailOverig}
        />
        <label className="inline-flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={saveEmailOverig}
            onChange={(e) => setSaveEmailOverig(e.target.checked)}
            className="rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400/30"
            disabled={!debiteurNr || !persist}
          />
          Opslaan als vast bevestigingsmailadres op klantpagina
        </label>
      </div>
      <label className="inline-flex items-center gap-2 text-xs text-slate-700 mt-1">
        <input
          type="checkbox"
          checked={persist}
          onChange={(e) => { setPersist(e.target.checked); if (!e.target.checked) { setSaveEmail(false); setSaveEmailOverig(false); setSaveEmailPakbon(false) } }}
          className="rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400/30"
          disabled={!debiteurNr}
        />
        Adreswijziging ook op klantpagina opslaan
      </label>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleApply}
          disabled={saving}
          className="px-3 py-1.5 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-xs font-medium hover:bg-terracotta-600 disabled:opacity-50"
        >
          {saving ? 'Opslaan…' : persist ? 'Opslaan + toepassen' : 'Toepassen op order'}
        </button>
      </div>
    </div>
  )
}

function ManualField({
  label, value, onChange, type = 'text',
}: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wide text-slate-500 mb-0.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 rounded-[var(--radius-sm)] border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
      />
    </div>
  )
}
