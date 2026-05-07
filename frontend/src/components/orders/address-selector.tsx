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
  gln_afleveradres: string | null
}

export interface AfleverAdres {
  naam: string
  adres: string
  postcode: string
  plaats: string
  land: string
}

interface AddressSelectorProps {
  debiteurNr: number | null
  onSelect: (addr: AfleverAdres) => void
  /** Wanneer afhalen aanstaat → tonen we adres-keuze niet (Karpi-locatie is dan het adres). */
  disabled?: boolean
}

const NIEUW_OPTION = '__nieuw__'

export function AddressSelector({ debiteurNr, onSelect, disabled = false }: AddressSelectorProps) {
  const [addresses, setAddresses] = useState<Address[]>([])
  const [selectedGln, setSelectedGln] = useState<string | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [manual, setManual] = useState<AfleverAdres>({ naam: '', adres: '', postcode: '', plaats: '', land: 'NL' })
  const [persist, setPersist] = useState(false)
  const [savingError, setSavingError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!debiteurNr) { setAddresses([]); setSelectedGln(null); return }
    supabase
      .from('afleveradressen')
      .select('id, adres_nr, naam, adres, postcode, plaats, land, gln_afleveradres')
      .eq('debiteur_nr', debiteurNr)
      .order('adres_nr')
      .then(({ data }) => setAddresses((data ?? []) as Address[]))
  }, [debiteurNr])

  if (disabled) return null

  async function handleApplyManual() {
    if (!manual.naam.trim() || !manual.adres.trim() || !manual.plaats.trim()) {
      setSavingError('Naam, adres en plaats zijn verplicht')
      return
    }
    setSavingError(null)

    if (persist && debiteurNr) {
      setSaving(true)
      try {
        // Volgend adres_nr bepalen — adres_nr 0 = hoofdadres, dus +1 op max bestaande.
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
          })
          .select('id, adres_nr, naam, adres, postcode, plaats, land, gln_afleveradres')
          .single()
        if (error) throw error
        if (nieuw) setAddresses((prev) => [...prev, nieuw as Address])
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
            onChange={(e) => {
              const v = e.target.value
              if (v === NIEUW_OPTION) {
                setManualOpen(true)
                e.target.value = ''
                return
              }
              const addr = addresses.find(a => a.id === Number(v))
              if (addr) {
                onSelect({
                  naam: addr.naam ?? '',
                  adres: addr.adres ?? '',
                  postcode: addr.postcode ?? '',
                  plaats: addr.plaats ?? '',
                  land: addr.land ?? 'NL',
                })
                setSelectedGln(addr.gln_afleveradres ?? null)
              } else {
                setSelectedGln(null)
              }
            }}
            className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm"
          >
            <option value="">Kies een afleveradres...</option>
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

function ManualField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wide text-slate-500 mb-0.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 rounded-[var(--radius-sm)] border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
      />
    </div>
  )
}
