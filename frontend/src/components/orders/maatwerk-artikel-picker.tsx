import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
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
 *
 * De resultatenlijst wordt via een portal (position:fixed) buiten de tabel
 * gerenderd — anders knipt de `overflow-x-auto`-wrapper van de regels-tabel hem af.
 */
export function MaatwerkArtikelPicker({ onSelect }: { onSelect: (a: MaatwerkArtikelKeuze) => void }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ProductRow[]>([])
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<
    { left: number; width: number; openUp: boolean; top: number; bottom: number; maxHeight: number } | null
  >(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

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

  // Positioneer de portal-dropdown onder de input; volg scroll/resize.
  useEffect(() => {
    if (!open) return
    const update = () => {
      const r = inputRef.current?.getBoundingClientRect()
      if (!r) return
      const margin = 8
      const width = Math.max(r.width, 320)
      const spaceBelow = window.innerHeight - r.bottom - margin
      const spaceAbove = r.top - margin
      // Klap omhoog als er onder te weinig ruimte is én boven meer plek is.
      const openUp = spaceBelow < 220 && spaceAbove > spaceBelow
      const maxHeight = Math.max(140, Math.min(320, openUp ? spaceAbove : spaceBelow))
      const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin))
      setCoords({
        left,
        width,
        openUp,
        top: r.bottom + 4,
        bottom: window.innerHeight - r.top + 4,
        maxHeight,
      })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || dropdownRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={wrapRef} className="relative inline-block w-72">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Zoek artikel op nr, code, omschrijving..."
          className="w-full pl-8 pr-3 py-1 rounded border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-terracotta-400/30"
        />
      </div>

      {open && coords && search.length >= 2 && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            left: coords.left,
            width: coords.width,
            maxHeight: coords.maxHeight,
            zIndex: 9999,
            ...(coords.openUp ? { bottom: coords.bottom } : { top: coords.top }),
          }}
          className="bg-white border border-slate-200 rounded shadow-lg overflow-y-auto"
        >
          {results.length === 0 ? (
            <div className="p-2 text-xs text-slate-400">Geen artikelen gevonden</div>
          ) : (
            results.map((p) => (
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
            ))
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
