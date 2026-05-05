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

interface AddressSelectorProps {
  debiteurNr: number | null
  onSelect: (addr: { naam: string; adres: string; postcode: string; plaats: string; land: string }) => void
}

export function AddressSelector({ debiteurNr, onSelect }: AddressSelectorProps) {
  const [addresses, setAddresses] = useState<Address[]>([])
  const [selectedGln, setSelectedGln] = useState<string | null>(null)

  useEffect(() => {
    if (!debiteurNr) { setAddresses([]); setSelectedGln(null); return }
    supabase
      .from('afleveradressen')
      .select('id, adres_nr, naam, adres, postcode, plaats, land, gln_afleveradres')
      .eq('debiteur_nr', debiteurNr)
      .order('adres_nr')
      .then(({ data }) => setAddresses((data ?? []) as Address[]))
  }, [debiteurNr])

  if (addresses.length === 0) return null

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">Afleveradres</label>
      <select
        onChange={(e) => {
          const addr = addresses.find(a => a.id === Number(e.target.value))
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
      </select>
      {selectedGln && (
        <p className="mt-1 text-xs text-slate-500">
          GLN: <span className="font-mono font-medium text-slate-700">{selectedGln}</span>
        </p>
      )}
    </div>
  )
}
