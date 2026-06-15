import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'

interface Address {
  id: number
  adres_nr: number
  naam: string | null
  adres: string | null
  postcode: string | null
  plaats: string | null
  land: string | null
  email: string | null
  gln_afleveradres: string | null
}

export interface AfleverAdres {
  naam: string
  adres: string
  postcode: string
  plaats: string
  land: string
  /** E-mailadres van dit afleveradres (mig 364), NULL als niet ingevuld. */
  email: string | null
  /** Intern DB-id van het afleveradressen-record (UI-only, voor "opslaan als permanent"). */
  afleveradresId?: number
}

interface AddressSelectorProps {
  debiteurNr: number | null
  onSelect: (addr: AfleverAdres) => void
  /** Wanneer afhalen aanstaat → tonen we adres-keuze niet (Karpi-locatie is dan het adres). */
  disabled?: boolean
  /** FALSE in edit-modus: het auto-selecteren van het eerste afleveradres bij
   *  mount zou daar het opgeslagen order-adres (incl. afl_email) overschrijven
   *  nog vóór de gebruiker iets doet (incident ORD-2026-0350, 11-06-2026). */
  autoSelect?: boolean
}

const NIEUW_OPTION = '__nieuw__'

export function AddressSelector({ debiteurNr, onSelect, disabled = false, autoSelect = true }: AddressSelectorProps) {
  const [addresses, setAddresses] = useState<Address[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [selectedGln, setSelectedGln] = useState<string | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [manual, setManual] = useState<{ naam: string; adres: string; postcode: string; plaats: string; land: string; telefoon: string; email: string; gln_afleveradres: string }>({ naam: '', adres: '', postcode: '', plaats: '', land: 'NL', telefoon: '', email: '', gln_afleveradres: '' })
  const [persist, setPersist] = useState(false)
  const [savingError, setSavingError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!debiteurNr) { setAddresses([]); setSelectedId(''); setSelectedGln(null); return }
    supabase
      .from('afleveradressen')
      .select('id, adres_nr, naam, adres, postcode, plaats, land, email, gln_afleveradres')
      .eq('debiteur_nr', debiteurNr)
      .order('adres_nr')
      .then(({ data }) => {
        const addrs = (data ?? []) as Address[]
        setAddresses(addrs)
        // Auto-selecteer eerste echte afleveradres (adres_nr > 0); adres_nr 0 is het factuuradres
        const defaultAddr = addrs.find(a => a.adres_nr > 0)
        if (autoSelect && defaultAddr) {
          setSelectedId(String(defaultAddr.id))
          setSelectedGln(defaultAddr.gln_afleveradres ?? null)
          onSelect({
            naam: defaultAddr.naam ?? '',
            adres: defaultAddr.adres ?? '',
            postcode: defaultAddr.postcode ?? '',
            plaats: defaultAddr.plaats ?? '',
            land: defaultAddr.land ?? 'NL',
            email: defaultAddr.email ?? null,
            afleveradresId: defaultAddr.id,
          })
        }
      })
  }, [debiteurNr])

  if (disabled) return null

  async function handleApplyManual() {
    if (!manual.naam.trim() || !manual.adres.trim() || !manual.plaats.trim()) {
      setSavingError('Naam, adres en plaats zijn verplicht')
      return
    }
    setSavingError(null)

    let nieuwId: number | undefined
    if (persist && debiteurNr) {
      setSaving(true)
      try {
        const maxNr = addresses.reduce((m, a) => Math.max(m, a.adres_nr), 0)
        const { data: nieuw, error } = await supabase
          .from('afleveradressen')
          .insert({
            debiteur_nr: debiteurNr,
            adres_nr: maxNr + 1,
            naam: manual.naam.trim(),
            adres: manual.adres.trim(),
            postcode: manual.postcode.trim() || null,
            plaats: manual.plaats.trim(),
            land: manual.land.trim() || 'NL',
            telefoon: manual.telefoon.trim() || null,
            email: manual.email.trim() || null,
            gln_afleveradres: manual.gln_afleveradres.trim() || null,
          })
          .select('id, adres_nr, naam, adres, postcode, plaats, land, email, gln_afleveradres')
          .single()
        if (error) throw error
        if (nieuw) {
          setAddresses((prev) => [...prev, nieuw as Address])
          nieuwId = (nieuw as Address).id
        }
      } catch (e) {
        setSavingError(e instanceof Error ? e.message : 'Opslaan mislukt')
        setSaving(false)
        return
      }
      setSaving(false)
    }

    onSelect({
      naam: manual.naam.trim(),
      adres: manual.adres.trim(),
      postcode: manual.postcode.trim(),
      plaats: manual.plaats.trim(),
      land: manual.land.trim() || 'NL',
      email: manual.email.trim() || null,
      afleveradresId: nieuwId,
    })
    setSelectedGln(null)
    setManualOpen(false)
    setPersist(false)
  }

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">Afleveradres</label>

      {!manualOpen && (
        <>
          <select
            value={selectedId}
            onChange={(e) => {
              const v = e.target.value
              if (v === NIEUW_OPTION) {
                setManualOpen(true)
                setSelectedId('')
                return
              }
              setSelectedId(v)
              const addr = addresses.find(a => a.id === Number(v))
              if (addr) {
                onSelect({
                  naam: addr.naam ?? '',
                  adres: addr.adres ?? '',
                  postcode: addr.postcode ?? '',
                  plaats: addr.plaats ?? '',
                  land: addr.land ?? 'NL',
                  email: addr.email ?? null,
                  afleveradresId: addr.id,
                })
                setSelectedGln(addr.gln_afleveradres ?? null)
              } else {
                setSelectedGln(null)
              }
            }}
            className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm"
          >
            {!selectedId && <option value="">Kies een afleveradres...</option>}
            {addresses.map((a) => (
              <option key={a.id} value={a.id}>
                #{a.adres_nr} — {a.naam} — {a.adres}, {a.postcode} {a.plaats}
              </option>
            ))}
            <option value={NIEUW_OPTION}>+ Nieuw afleveradres invullen…</option>
          </select>
          {selectedGln && (
            <p className="mt-1 text-xs text-slate-500">
              GLN: <span className="font-mono font-medium text-slate-700">{selectedGln}</span>
            </p>
          )}
        </>
      )}

      {manualOpen && (
        <div className="border border-slate-200 rounded-[var(--radius-sm)] p-3 bg-slate-50 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-600">Nieuw afleveradres</p>
            <button
              type="button"
              onClick={() => { setManualOpen(false); setSavingError(null) }}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              ← Terug naar lijst
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <ManualField label="Naam" value={manual.naam} onChange={(v) => setManual(m => ({ ...m, naam: v }))} />
            <ManualField label="Adres" value={manual.adres} onChange={(v) => setManual(m => ({ ...m, adres: v }))} />
            <ManualField label="Postcode" value={manual.postcode} onChange={(v) => setManual(m => ({ ...m, postcode: v }))} />
            <ManualField label="Plaats" value={manual.plaats} onChange={(v) => setManual(m => ({ ...m, plaats: v }))} />
            <ManualField label="Land" value={manual.land} onChange={(v) => setManual(m => ({ ...m, land: v }))} />
            <ManualField label="Telefoon" value={manual.telefoon} onChange={(v) => setManual(m => ({ ...m, telefoon: v }))} type="tel" />
            <ManualField label="E-mail" value={manual.email} onChange={(v) => setManual(m => ({ ...m, email: v }))} type="email" />
            <ManualField label="GLN-afleveradres" value={manual.gln_afleveradres} onChange={(v) => setManual(m => ({ ...m, gln_afleveradres: v }))} />
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 mt-1">
            <input
              type="checkbox"
              checked={persist}
              onChange={(e) => setPersist(e.target.checked)}
              className="rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400/30"
              disabled={!debiteurNr}
            />
            Opslaan in adresboek voor toekomstige orders
          </label>
          {savingError && (
            <p className="text-xs text-rose-600">{savingError}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleApplyManual}
              disabled={saving}
              className="px-3 py-1.5 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-xs font-medium hover:bg-terracotta-600 disabled:opacity-50"
            >
              {saving ? 'Opslaan…' : 'Toepassen op order'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ManualField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
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
