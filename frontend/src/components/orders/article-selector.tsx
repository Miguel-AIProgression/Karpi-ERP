import { useState, useEffect, useRef } from 'react'
import { Search } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { sanitizeSearch } from '@/lib/utils/sanitize'
import { SubstitutionPicker } from './substitution-picker'

export interface SelectedArticle {
  artikelnr: string
  karpi_code: string | null
  omschrijving: string
  verkoopprijs: number | null
  gewicht_kg: number | null
  vrije_voorraad: number
  besteld_inkoop: number
  kwaliteit_code: string | null
}

export interface SubstitutionInfo {
  fysiek_artikelnr: string
  fysiek_omschrijving: string
  fysiek_karpi_code: string | null
  fysiek_vrije_voorraad: number
  omstickeren: true
}

interface ArticleSelectorProps {
  onSelect: (article: SelectedArticle, substitution?: SubstitutionInfo) => void
}

export function ArticleSelector({ onSelect }: ArticleSelectorProps) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<SelectedArticle[]>([])
  const [open, setOpen] = useState(false)
  const [pendingArticle, setPendingArticle] = useState<SelectedArticle | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!search || search.length < 2) { setResults([]); return }
    const s = sanitizeSearch(search)
    if (!s) return

    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('producten')
        .select('artikelnr, karpi_code, omschrijving, verkoopprijs, gewicht_kg, vrije_voorraad, besteld_inkoop, kwaliteit_code')
        .eq('actief', true)
        .neq('artikelnr', 'VERZEND')
        .or(`artikelnr.ilike.%${s}%,karpi_code.ilike.%${s}%,omschrijving.ilike.%${s}%,zoeksleutel.ilike.%${s}%`)
        .limit(10)

      setResults((data ?? []) as SelectedArticle[])
    }, 300)

    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setPendingArticle(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Zoek artikel op nr, code, omschrijving..."
          className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
        />
      </div>

      {open && search.length >= 2 && results.length === 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-[var(--radius-sm)] shadow-lg p-3 text-sm text-slate-400">
          Geen artikelen gevonden
        </div>
      )}

      {open && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-[var(--radius-sm)] shadow-lg max-h-60 overflow-y-auto">
          {results.map((article) => (
            <button
              key={article.artikelnr}
              type="button"
              onClick={() => {
                if (article.vrije_voorraad <= 0) {
                  setPendingArticle(article)
                  setSearch('')
                  setOpen(false)
                } else {
                  onSelect(article)
                  setSearch('')
                  setOpen(false)
                }
              }}
              className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-xs text-terracotta-500">{article.artikelnr}</span>
                  <span className="ml-2">{article.omschrijving}</span>
                </div>
                <div className="text-xs text-right shrink-0 ml-2">
                  <span className={article.vrije_voorraad > 0 ? 'text-emerald-600' : 'text-rose-500'}>
                    Vrij: {article.vrije_voorraad}
                  </span>
                  {article.besteld_inkoop > 0 && (
                    <span className="text-slate-400 ml-2">Verwacht: {article.besteld_inkoop}</span>
                  )}
                </div>
              </div>
              {article.karpi_code && (
                <div className="text-xs text-slate-400">{article.karpi_code}</div>
              )}
            </button>
          ))}
        </div>
      )}

      {pendingArticle && (
        <div className="mt-2">
          <SubstitutionPicker
            artikelnr={pendingArticle.artikelnr}
            omschrijving={pendingArticle.omschrijving}
            onSelect={(equivalent) => {
              onSelect(pendingArticle, {
                fysiek_artikelnr: equivalent.artikelnr,
                fysiek_omschrijving: equivalent.omschrijving,
                fysiek_karpi_code: equivalent.karpi_code,
                fysiek_vrije_voorraad: equivalent.vrije_voorraad,
                omstickeren: true,
              })
              setPendingArticle(null)
            }}
            onSkip={() => {
              onSelect(pendingArticle)
              setPendingArticle(null)
            }}
          />
        </div>
      )}
    </div>
  )
}
