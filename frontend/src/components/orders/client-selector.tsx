import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
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
  email_factuur: string | null
  email_overig: string | null
  /** Klant-niveau verzend-/T&T-e-mailadres (mig 369). Default-ladder afl_email: afleveradres → dit veld → email_overig. */
  email_verzend: string | null
  /** Optioneel pakbon-e-mailadres (mig 496). Huidig: alleen vastleggen, routing via email_factuur. */
  email_pakbon: string | null
  vertegenw_code: string | null
  prijslijst_nr: string | null
  korting_pct: number
  betaler: number | null
  inkooporganisatie: string | null
  gratis_verzending: boolean
  verzendkosten: number
  verzend_drempel: number
  standaard_maat_werkdagen: number | null
  maatwerk_weken: number | null
  deelleveringen_toegestaan: boolean
  /** ADR 0014 / mig 244: standaard lever_type bij orderaanmaak ('week' of 'datum'). */
  default_lever_type: 'week' | 'datum'
  /** Klantvoorkeur 'Afhalen' of 'Bezorgen' — bepaalt default van de afhalen-checkbox bij orderaanmaak. */
  afleverwijze: string | null
  /** Mig 528: klant-toeslag instellingen — geldigheidscheck in applyToeslagLogic. */
  toeslag_actief: boolean
  toeslag_procent: number | null
  toeslag_omschrijving: string | null
  toeslag_begindatum: string | null
  toeslag_einddatum: string | null
  /** Mig 117: per_zending = factuur direct na elke zending; wekelijks = verzamelfactuur maandag 05:00 UTC. */
  factuurvoorkeur: 'per_zending' | 'wekelijks' | null
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
      // inkooporganisatie als snapshot-string komt uit FK inkoopgroepen.naam
      // (mig 189 dropte de oude TEXT-kolom op debiteuren).
      // LET OP: deze select + mapping is gespiegeld in
      // lib/supabase/queries/po-parsing.ts (fetchSelectedClientVoorPrefill).
      // Wijzig je de kolomlijst hier, pas 'm daar óók aan.
      let query = supabase
        .from('debiteuren')
        .select('debiteur_nr, naam, adres, postcode, plaats, land, fact_naam, fact_adres, fact_postcode, fact_plaats, email_factuur, email_overig, email_verzend, email_pakbon, vertegenw_code, prijslijst_nr, korting_pct, betaler, inkoopgroepen(naam), gratis_verzending, standaard_maat_werkdagen, maatwerk_weken, deelleveringen_toegestaan, default_lever_type, afleverwijze, toeslag_actief, toeslag_procent, toeslag_omschrijving, toeslag_begindatum, toeslag_einddatum, factuurvoorkeur')
        .eq('status', 'Actief')
        .limit(50)

      if (numSearch) {
        query = query.or(`naam.ilike.%${s}%,debiteur_nr.eq.${numSearch}`)
      } else {
        query = query.ilike('naam', `%${s}%`)
      }

      const { data, error } = await query
      if (error) {
        console.error('ClientSelector zoekquery faalde:', error)
        setResults([])
        return
      }
      const mapped: SelectedClient[] = (data ?? []).map((row) => {
        const { inkoopgroepen, ...rest } = row as unknown as Record<string, unknown> & {
          inkoopgroepen: { naam: string } | null
        }
        return {
          ...(rest as unknown as Omit<SelectedClient, 'inkooporganisatie'>),
          inkooporganisatie: inkoopgroepen?.naam ?? null,
        }
      })
      setResults(mapped)
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
        <div className="flex-1 flex items-center gap-3">
          <Link
            to={`/klanten/${value.debiteur_nr}`}
            target="_blank"
            className="font-medium text-terracotta-600 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {value.naam}
          </Link>
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-terracotta-50 text-terracotta-700 border border-terracotta-200 text-sm font-semibold tabular-nums">
            #{value.debiteur_nr}
          </span>
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
      <div className="flex items-center gap-3 p-3 bg-slate-100 rounded-[var(--radius-sm)] border border-slate-200">
        <Link
          to={`/klanten/${value.debiteur_nr}`}
          target="_blank"
          className="font-medium text-terracotta-600 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {value.naam}
        </Link>
        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-terracotta-50 text-terracotta-700 border border-terracotta-200 text-sm font-semibold tabular-nums">
          #{value.debiteur_nr}
        </span>
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
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-[var(--radius-sm)] shadow-lg flex flex-col max-h-[22rem]">
          <div className="shrink-0 px-4 py-1.5 text-xs text-slate-400 border-b border-slate-100 bg-slate-50 rounded-t-[var(--radius-sm)]">
            {results.length} klant{results.length !== 1 ? 'en' : ''} gevonden{results.length > 5 ? ' — scroll voor meer' : ''}
          </div>
          <div className="overflow-y-auto flex-1">
          {results.map((client) => (
            <button
              key={client.debiteur_nr}
              type="button"
              onClick={() => {
                onChange(client)
                setSearch('')
                setOpen(false)
              }}
              className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium text-sm leading-snug">{client.naam}</span>
                {client.plaats && (
                  <span className="shrink-0 text-sm font-semibold text-slate-700 leading-snug">{client.plaats}</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs font-mono text-terracotta-600">#{client.debiteur_nr}</span>
                {client.postcode && (
                  <span className="text-xs text-slate-400">{client.postcode}</span>
                )}
              </div>
            </button>
          ))}
          </div>
        </div>
      )}
    </div>
  )
}
