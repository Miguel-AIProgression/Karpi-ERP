import { useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import {
  DROPSHIP_EMAIL_MELDING,
  isBlokkerendDropshipEmailProbleem,
  type DropshipEmailProbleem,
} from '@/lib/orders/dropship-email'
import type { AfleverAdres } from './address-selector'

interface DeliveryAddressEditorProps {
  naam?: string
  adres?: string
  postcode?: string
  plaats?: string
  /** Per-order snapshot van het afleveradres-email (orders.afl_email). */
  aflEmail: string
  /** DB-id van het geselecteerde afleveradressen-record (voor "opslaan als permanent"). */
  afleveradresId?: number
  onAdresChange: (addr: Pick<AfleverAdres, 'naam' | 'adres' | 'postcode' | 'plaats' | 'land'>) => void
  onEmailChange: (email: string) => void
  /** Alleen gevuld bij dropshipment-orders: toets van het T&T-adres (dropship-email.ts). */
  dropshipEmailProbleem?: DropshipEmailProbleem | null
}

export function DeliveryAddressEditor({
  naam, adres, postcode, plaats,
  aflEmail, afleveradresId,
  onAdresChange, onEmailChange, dropshipEmailProbleem,
}: DeliveryAddressEditorProps) {
  const [editing, setEditing] = useState(false)
  type DraftAdres = Pick<AfleverAdres, 'naam' | 'adres' | 'postcode' | 'plaats' | 'land'>
  const [draftAdres, setDraftAdres] = useState<DraftAdres>({
    naam: naam ?? '',
    adres: adres ?? '',
    postcode: postcode ?? '',
    plaats: plaats ?? '',
    land: 'NL',
  })
  const [draftEmail, setDraftEmail] = useState(aflEmail)
  const [persist, setPersist] = useState(!!afleveradresId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function openEdit() {
    setDraftAdres({
      naam: naam ?? '',
      adres: adres ?? '',
      postcode: postcode ?? '',
      plaats: plaats ?? '',
      land: 'NL',
    })
    setDraftEmail(aflEmail)
    setPersist(!!afleveradresId)
    setError(null)
    setEditing(true)
  }

  async function handleApply() {
    if (!draftAdres.naam.trim()) {
      setError('Naam is verplicht')
      return
    }
    setError(null)

    const normAdres: DraftAdres = {
      naam: draftAdres.naam.trim(),
      adres: draftAdres.adres.trim(),
      postcode: draftAdres.postcode.trim(),
      plaats: draftAdres.plaats.trim(),
      land: draftAdres.land.trim() || 'NL',
    }
    const normEmail = draftEmail.trim()

    if (persist && afleveradresId) {
      setSaving(true)
      const { error: updErr } = await supabase
        .from('afleveradressen')
        .update({
          naam: normAdres.naam,
          adres: normAdres.adres || null,
          postcode: normAdres.postcode || null,
          plaats: normAdres.plaats || null,
          land: normAdres.land || null,
          email: normEmail || null,
        })
        .eq('id', afleveradresId)
      setSaving(false)
      if (updErr) {
        setError(updErr.message || 'Opslaan op klantpagina mislukt')
        return
      }
    }

    onAdresChange(normAdres)
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
            Wijzigen
          </button>
        </div>
        <div className="text-sm">
          {naam && <p className="font-medium">{naam}</p>}
          {adres && <p>{adres}</p>}
          <p>{[postcode, plaats].filter(Boolean).join(' ')}</p>
          {aflEmail && (
            <p className="mt-1 text-slate-500 text-xs">
              {aflEmail} <span className="text-slate-400">· track &amp; trace</span>
            </p>
          )}
          {!aflEmail && dropshipEmailProbleem !== 'ontbreekt' && (
            <p className="mt-1 text-amber-600 text-xs italic">
              Geen e-mailadres — klant ontvangt geen track &amp; trace
            </p>
          )}
          {dropshipEmailProbleem === 'ontbreekt' && (
            <p className="mt-1 text-amber-600 text-xs">
              {DROPSHIP_EMAIL_MELDING.ontbreekt}
            </p>
          )}
          {isBlokkerendDropshipEmailProbleem(dropshipEmailProbleem ?? null) && (
            <p className="mt-1 text-rose-600 text-xs">
              {DROPSHIP_EMAIL_MELDING[dropshipEmailProbleem!]}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="border border-slate-200 rounded-[var(--radius-sm)] p-3 bg-slate-50 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-600">Afleveradres wijzigen</p>
        <button
          type="button"
          onClick={() => { setEditing(false); setError(null) }}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          Annuleren
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <AflField label="Naam" value={draftAdres.naam} onChange={(v) => setDraftAdres(d => ({ ...d, naam: v }))} />
        <AflField label="Adres" value={draftAdres.adres} onChange={(v) => setDraftAdres(d => ({ ...d, adres: v }))} />
        <AflField label="Postcode" value={draftAdres.postcode} onChange={(v) => setDraftAdres(d => ({ ...d, postcode: v }))} />
        <AflField label="Plaats" value={draftAdres.plaats} onChange={(v) => setDraftAdres(d => ({ ...d, plaats: v }))} />
        <AflField label="Land" value={draftAdres.land} onChange={(v) => setDraftAdres(d => ({ ...d, land: v }))} />
      </div>
      <div className="pt-2 mt-2 border-t border-slate-200">
        <AflField
          label="E-mail (track & trace)"
          type="email"
          value={draftEmail}
          onChange={setDraftEmail}
        />
        <p className="mt-1 text-[11px] text-slate-400">
          De vervoerder stuurt de track &amp; trace naar dit e-mailadres.
        </p>
      </div>
      {afleveradresId && (
        <label className="inline-flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={persist}
            onChange={(e) => setPersist(e.target.checked)}
            className="rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400/30"
          />
          Adreswijziging ook op klantpagina opslaan
        </label>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleApply}
          disabled={saving}
          className="px-3 py-1.5 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-xs font-medium hover:bg-terracotta-600 disabled:opacity-50"
        >
          {saving ? 'Opslaan…' : persist && afleveradresId ? 'Opslaan + toepassen' : 'Toepassen op order'}
        </button>
      </div>
    </div>
  )
}

function AflField({
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
