import { useState, useEffect, useRef } from 'react'
import { Search } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { sanitizeSearch, applyProductSearch, filterProductsWordBoundary } from '@/lib/utils/sanitize'

export interface MaatwerkArtikelKeuze {
  artikelnr: string
  karpi_code: string | null
  omschrijving: string
}

interface ProductRow extends MaatwerkArtikelKeuze {
  kwaliteit_code: string | null
  kleur_code: string | null
  product_type: string | null
}

/**
 * Compacte product-picker om handmatig een artikel aan een MAATWERK-regel te
 * koppelen (zet alleen artikelnr + karpi_code). Bewust lichter dan
 * `ArticleSelector`: géén SubstitutionPicker/voorraad-gate — die omsticker-flow
 * is voor vaste-maat-regels en zou bij maatwerk-broadloom (0 voorraad) altijd
 * onterecht openen. Zoekt actieve, niet-pseudo producten; toont type + karpi_code.
 */
export function MaatwerkArtikelPicker({ onSelect }: { onSelect: (a: MaatwerkArtikelKeuze) => void }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ProductRow[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!search || search.length < 2) { setResults([]); return }
    if (!sanitizeSearch(search)) return
    const timer = setTimeout(async () => {
      const base = supabase
        .from('producten')
        .select('artikelnr, karpi_code, omschrijving, kwaliteit_code, kleur_code, product_type')
        .eq('actief', true)
        .eq('is_pseudo', false)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const query = applyProductSearch(base as any, search)
      const { data } = await query.order('omschrijving').limit(500)
      setResults(filterProductsWordBoundary((data ?? []) as ProductRow[], search).slice(0, 50))
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative inline-block w-72">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Zoek artikel op nr, code, omschrijving..."
          className="w-full pl-8 pr-3 py-1 rounded border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-terracotta-400/30"
        />
      </div>

      {open && search.length >= 2 && results.length === 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded shadow-lg p-2 text-xs text-slate-400">
          Geen artikelen gevonden
        </div>
      )}

      {open && results.length > 0 && (
        <div className="absolute z-50 w-80 mt-1 bg-white border border-slate-200 rounded shadow-lg max-h-60 overflow-y-auto">
          {results.map((p) => (
            <button
              key={p.artikelnr}
              type="button"
              onClick={() => {
                onSelect({ artikelnr: p.artikelnr, karpi_code: p.karpi_code, omschrijving: p.omschrijving })
                setSearch('')
                setOpen(false)
              }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 border-b border-slate-50 last:border-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-terracotta-500">{p.artikelnr}</span>
                {p.product_type && (
                  <span className="text-[10px] uppercase tracking-wide text-slate-400 shrink-0">{p.product_type}</span>
                )}
              </div>
              <div className="text-slate-700">{p.omschrijving}</div>
              {p.karpi_code && <div className="text-slate-400">{p.karpi_code}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
