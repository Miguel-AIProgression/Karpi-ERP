import { useState, useEffect, useRef } from 'react'
import { Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchKwaliteiten,
  fetchKleurenVoorKwaliteit,
  type KwaliteitOptie,
  type KleurOptie,
} from '@/lib/supabase/queries/op-maat'
import { formatCurrency } from '@/lib/utils/formatters'

export interface KwaliteitKleurData {
  kwaliteitCode: string
  kwaliteitNaam: string
  kleurCode: string
  kleurLabel: string              // display zonder '.0'
  kleurOmschrijving: string
  verkoopprijsM2: number
  kostprijsM2: number | null
  gewichtPerM2Kg: number | null
  maxBreedteCm: number | null
  artikelnr: string | null        // rol-product voor koppeling
  karpiCode: string | null
}

interface KwaliteitKleurSelectorProps {
  onSelect: (data: KwaliteitKleurData) => void
}

export function KwaliteitKleurSelector({ onSelect }: KwaliteitKleurSelectorProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [selectedKwaliteit, setSelectedKwaliteit] = useState<KwaliteitOptie | null>(null)
  const [selectedKleurCode, setSelectedKleurCode] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  // Fetch all kwaliteiten once
  const {
    data: kwaliteiten,
    isLoading: kwaliteitenLoading,
    isError: kwaliteitenError,
  } = useQuery({
    queryKey: ['kwaliteiten'],
    queryFn: fetchKwaliteiten,
  })

  // Fetch kleuren when kwaliteit selected
  const {
    data: kleuren,
    isLoading: kleurenLoading,
    isError: kleurenError,
    error: kleurenErrorObj,
  } = useQuery({
    queryKey: ['kleuren', selectedKwaliteit?.code],
    queryFn: () => fetchKleurenVoorKwaliteit(selectedKwaliteit!.code),
    enabled: !!selectedKwaliteit,
  })

  // Client-side filter
  const filtered = (kwaliteiten ?? [])
    .filter((k) => {
      if (!k.code) return false
      if (!search) return true
      const q = search.toLowerCase()
      return k.code.toLowerCase().includes(q) || (k.omschrijving ?? '').toLowerCase().includes(q)
    })
    .slice(0, 30)

  // Click-outside handler
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Handle kleur selection
  function handleKleurChange(kleurCode: string) {
    setSelectedKleurCode(kleurCode)
    if (!kleurCode || !selectedKwaliteit || !kleuren) return

    const kleur = kleuren.find((k) => k.kleur_code === kleurCode)
    if (!kleur || kleur.verkoopprijs_m2 == null) return

    onSelect({
      kwaliteitCode: selectedKwaliteit.code,
      kwaliteitNaam: selectedKwaliteit.omschrijving ?? selectedKwaliteit.code,
      kleurCode: kleur.kleur_code,
      kleurLabel: kleur.kleur_label,
      kleurOmschrijving: kleur.omschrijving,
      verkoopprijsM2: kleur.verkoopprijs_m2,
      kostprijsM2: kleur.kostprijs_m2,
      gewichtPerM2Kg: kleur.gewicht_per_m2_kg,
      maxBreedteCm: kleur.max_breedte_cm,
      artikelnr: kleur.artikelnr,
      karpiCode: kleur.karpi_code,
    })
  }

  // Reset to step 1
  function handleReset() {
    setSelectedKwaliteit(null)
    setSelectedKleurCode('')
    setSearch('')
  }

  if (kwaliteitenLoading) {
    return <div className="text-sm text-slate-400">Laden...</div>
  }

  if (kwaliteitenError) {
    return (
      <div className="p-3 rounded-[var(--radius-sm)] bg-red-50 text-red-700 text-sm">
        Fout bij laden van kwaliteiten.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {/* Stap 1: Kwaliteit */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Kwaliteit</label>
        {selectedKwaliteit ? (
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-[var(--radius-sm)] border border-slate-200">
            <div className="flex-1">
              <span className="font-mono text-xs text-purple-600">{selectedKwaliteit.code}</span>
              <span className="ml-2 text-sm">{selectedKwaliteit.omschrijving}</span>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-slate-500 hover:text-purple-600"
            >
              Wijzig kwaliteit
            </button>
          </div>
        ) : (
          <div ref={ref} className="relative">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
                onFocus={() => setOpen(true)}
                placeholder="Zoek kwaliteit op code of naam..."
                className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/30 focus:border-purple-400"
              />
            </div>

            {open && search.length >= 1 && filtered.length === 0 && (
              <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-[var(--radius-sm)] shadow-lg p-3 text-sm text-slate-400">
                Geen kwaliteiten gevonden
              </div>
            )}

            {open && filtered.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-[var(--radius-sm)] shadow-lg max-h-60 overflow-y-auto">
                {filtered.map((kwaliteit) => (
                  <button
                    key={kwaliteit.code}
                    type="button"
                    onClick={() => {
                      setSelectedKwaliteit(kwaliteit)
                      setSearch('')
                      setOpen(false)
                      setSelectedKleurCode('')
                    }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0"
                  >
                    <span className="font-mono text-xs text-purple-600">{kwaliteit.code}</span>
                    <span className="ml-2">{kwaliteit.omschrijving}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stap 2: Kleur */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Kleur</label>
        {kleurenError ? (
          <div className="p-3 rounded-[var(--radius-sm)] bg-red-50 text-red-700 text-sm">
            Fout bij laden van kleuren: {(kleurenErrorObj as Error)?.message ?? 'Onbekende fout'}
          </div>
        ) : (
          <select
            value={selectedKleurCode}
            onChange={(e) => handleKleurChange(e.target.value)}
            disabled={!selectedKwaliteit || kleurenLoading}
            className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/30 focus:border-purple-400 disabled:bg-slate-100 disabled:text-slate-400"
          >
            <option value="">
              {kleurenLoading
                ? 'Laden...'
                : !selectedKwaliteit
                  ? 'Selecteer eerst een kwaliteit'
                  : `Selecteer een kleur (${(kleuren ?? []).length} beschikbaar)`}
            </option>
            {(kleuren ?? []).map((kleur) => {
              const totaalM2 = (kleur.beschikbaar_m2 ?? 0) + (kleur.equiv_m2 ?? 0)
              const totaalRollen = (kleur.aantal_rollen ?? 0) + (kleur.equiv_rollen ?? 0)
              const heeftEquiv = (kleur.equiv_rollen ?? 0) > 0
              return (
                <option key={kleur.kleur_code} value={kleur.kleur_code}>
                  {kleur.kleur_label ?? kleur.kleur_code} — {kleur.omschrijving}
                  {' | '}{kleur.verkoopprijs_m2 != null ? formatCurrency(kleur.verkoopprijs_m2) : '—'}/m²
                  {' | '}{kleur.aantal_rollen ?? 0} rol{(kleur.aantal_rollen ?? 0) !== 1 ? 'len' : ''} ({kleur.beschikbaar_m2 ?? 0} m²)
                  {heeftEquiv ? ` +${kleur.equiv_rollen} equiv (${kleur.equiv_m2} m²)` : ''}
                </option>
              )
            })}
          </select>
        )}
      </div>
    </div>
  )
}
