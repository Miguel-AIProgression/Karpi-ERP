import { useState, useEffect, useRef } from 'react'
import { Search } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { sanitizeSearch } from '@/lib/utils/sanitize'

export interface SelectedClient {
  debiteur_nr: number
  naam: string
  adres: string | null
  postcode: string | null
  plaats: string | null
  land: string | null
  fact_naam: string | null
  fact_adres: string | null
  fact_postcode: string | null
  fact_plaats: string | null
  vertegenw_code: string | null
  prijslijst_nr: string | null
  korting_pct: number
  betaler: number | null
  inkooporganisatie: string | null
}

interface ClientSelectorProps {
  value: SelectedClient | null
  onChange: (client: SelectedClient | null) => void
  disabled?: boolean
}

export function ClientSelector({ value, onChange, disabled }: ClientSelectorProps) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<SelectedClient[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!search || search.length < 2) { setResults([]); return }
    const s = sanitizeSearch(search)
    if (!s) return

    const timer = setTimeout(async () => {
      const numSearch = Number(search)
      let query = supabase
        .from('debiteuren')
        .select('debiteur_nr, naam, adres, postcode, plaats, land, fact_naam, fact_adres, fact_postcode, fact_plaats, vertegenw_code, prijslijst_nr, korting_pct, betaler, inkooporganisatie')
        .eq('status', 'Actief')
        .limit(10)

      if (numSearch) {
        query = query.or(`naam.ilike.%${s}%,debiteur_nr.eq.${numSearch}`)
      } else {
        query = query.ilike('naam', `%${s}%`)
      }

      const { data } = await query
      setResults((data ?? []) as SelectedClient[])
    }, 300)

    return () => clearTimeout(timer)
  }, [search])

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (value && !disabled) {
    return (
      <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-[var(--radius-sm)] border border-slate-200">
        <div className="flex-1">
          <span className="font-medium">{value.naam}</span>
          <span className="text-xs text-slate-400 ml-2">#{value.debiteur_nr}</span>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-xs text-slate-500 hover:text-rose-500"
        >
          Wijzig
        </button>
      </div>
    )
  }

  if (disabled && value) {
    return (
      <div className="p-3 bg-slate-100 rounded-[var(--radius-sm)] border border-slate-200">
        <span className="font-medium">{value.naam}</span>
        <span className="text-xs text-slate-400 ml-2">#{value.debiteur_nr}</span>
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Zoek klant op naam of nummer..."
          className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
        />
      </div>

      {open && search.length >= 2 && results.length === 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-[var(--radius-sm)] shadow-lg p-3 text-sm text-slate-400">
          Geen klanten gevonden
        </div>
      )}

      {open && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-[var(--radius-sm)] shadow-lg max-h-60 overflow-y-auto">
          {results.map((client) => (
            <button
              key={client.debiteur_nr}
              type="button"
              onClick={() => {
                onChange(client)
                setSearch('')
                setOpen(false)
              }}
              className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0"
            >
              <span className="font-medium">{client.naam}</span>
              <span className="text-xs text-slate-400 ml-2">#{client.debiteur_nr}</span>
              {client.plaats && <span className="text-xs text-slate-400 ml-1">— {client.plaats}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
