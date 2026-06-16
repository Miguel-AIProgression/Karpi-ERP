import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Pencil, Link2, Check, X } from 'lucide-react'
import { fetchKwaliteitenMetGewicht, updateKwaliteitGewicht, type KwaliteitMetGewicht } from '@/lib/supabase/queries/kwaliteiten'
import {
  fetchAfwerkingTypes,
  fetchAlleStandaardAfwerkingen,
  fetchMaatwerkKwaliteiten,
  setStandaardAfwerking,
  clearStandaardAfwerking,
  type AfwerkingTypeRow,
} from '@/modules/maatwerk'
import { formatNumber } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import type { ProductType } from '@/lib/supabase/queries/producten'
import { KwaliteitKleurenUitvouw } from './kwaliteit-kleuren-uitvouw'

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null) {
    const e = err as { message?: string; details?: string; hint?: string; code?: string }
    const parts = [e.message, e.details, e.hint].filter(Boolean)
    if (parts.length > 0) return parts.join(' — ')
    try {
      return JSON.stringify(err)
    } catch {
      return 'Onbekende fout'
    }
  }
  return String(err)
}

interface Props {
  search: string
  productType: ProductType | 'alle'
}

export function KwaliteitenGroupedView({ search, productType }: Props) {
  const { data: kwaliteiten = [], isLoading } = useQuery({
    queryKey: ['kwaliteiten-met-gewicht'],
    queryFn: fetchKwaliteitenMetGewicht,
  })
  const { data: afwerkingen = [] } = useQuery({
    queryKey: ['afwerking-types', 'actief'],
    queryFn: fetchAfwerkingTypes,
    staleTime: 5 * 60 * 1000,
  })
  const { data: standaardAfwerkingen } = useQuery({
    queryKey: ['standaard-afwerkingen', 'all'],
    queryFn: fetchAlleStandaardAfwerkingen,
    staleTime: 60 * 1000,
  })
  const { data: maatwerkKwaliteiten } = useQuery({
    queryKey: ['maatwerk-kwaliteiten'],
    queryFn: fetchMaatwerkKwaliteiten,
    staleTime: 5 * 60 * 1000,
  })

  const [expanded, setExpanded] = useState<string | null>(null)

  const gefilterd = useMemo(() => {
    const term = search.trim().toLowerCase()
    const tokens = term.split(/\s+/).filter(Boolean)
    return kwaliteiten
      .filter((q) => q.aantal_producten > 0)
      .filter((q) => {
        if (!tokens.length) return true
        const haystack = `${q.code} ${q.omschrijving ?? ''} ${q.naam_afgeleid ?? ''}`.toLowerCase()
        return tokens.every((t) => haystack.includes(t))
      })
  }, [kwaliteiten, search])

  // Map: kwaliteit-code → aantal andere uitwisselbare kwaliteiten in dezelfde
  // collectie. Wordt getoond bij gewicht-edit zodat de gebruiker ziet hoeveel
  // kwaliteiten meeveranderen. Alleen collecties met ≥2 kwaliteiten tellen.
  const uitwisselbaarCounts = useMemo(() => {
    const byCollectie = new Map<number, string[]>()
    for (const k of kwaliteiten) {
      if (k.collectie_id != null) {
        if (!byCollectie.has(k.collectie_id)) byCollectie.set(k.collectie_id, [])
        byCollectie.get(k.collectie_id)!.push(k.code)
      }
    }
    const result = new Map<string, number>()
    for (const codes of byCollectie.values()) {
      if (codes.length >= 2) {
        for (const c of codes) result.set(c, codes.length - 1)
      }
    }
    return result
  }, [kwaliteiten])

  if (isLoading) {
    return <div className="text-slate-400">Kwaliteiten laden...</div>
  }

  if (gefilterd.length === 0) {
    return <div className="text-slate-400">Geen kwaliteiten gevonden</div>
  }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Kwaliteit</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600 w-[150px]">Afwerking</th>
            <th className="text-right px-4 py-3 font-medium text-slate-600 w-[140px]">Gewicht / m²</th>
            <th className="text-right px-4 py-3 font-medium text-slate-600 w-[120px]">Std breedte</th>
            <th className="text-right px-4 py-3 font-medium text-slate-600 w-[110px]">Producten</th>
          </tr>
        </thead>
        <tbody>
          {gefilterd.map((q) => (
            <KwaliteitRow
              key={q.code}
              q={q}
              isExpanded={expanded === q.code}
              onToggle={() => setExpanded((cur) => (cur === q.code ? null : q.code))}
              productType={productType}
              uitwisselbaarCount={uitwisselbaarCounts.get(q.code) ?? 0}
              afwerkingen={afwerkingen}
              standaardAfwerking={standaardAfwerkingen?.get(q.code) ?? null}
              isMaatwerkKwaliteit={maatwerkKwaliteiten?.has(q.code) ?? false}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function KwaliteitRow({ q, isExpanded, onToggle, productType, uitwisselbaarCount, afwerkingen, standaardAfwerking, isMaatwerkKwaliteit }: {
  q: KwaliteitMetGewicht
  isExpanded: boolean
  onToggle: () => void
  productType: ProductType | 'alle'
  uitwisselbaarCount: number
  afwerkingen: AfwerkingTypeRow[]
  standaardAfwerking: string | null
  isMaatwerkKwaliteit: boolean
}) {
  return (
    <>
      <tr className={cn('border-b border-slate-100 hover:bg-slate-50 cursor-pointer', isExpanded && 'bg-terracotta-50/40')} onClick={onToggle}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <button className="text-slate-400 hover:text-slate-600 -ml-1 p-0.5">
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-slate-800 text-sm">
                {q.omschrijving?.split(' ')[0] ?? q.naam_afgeleid ?? q.code}
              </span>
              <span className="font-mono text-[10px] text-slate-400 tracking-wide">
                {q.code}
              </span>
            </div>
            {uitwisselbaarCount > 0 && (
              <span
                className="inline-flex items-center gap-1 text-xs text-slate-500"
                title={`Uitwisselbaar met ${uitwisselbaarCount} ${uitwisselbaarCount === 1 ? 'kwaliteit' : 'kwaliteiten'} — gewichten worden samen beheerd`}
              >
                <Link2 size={11} />
                +{uitwisselbaarCount}
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          {isMaatwerkKwaliteit || standaardAfwerking ? (
            <AfwerkingEditor code={q.code} huidigeAfwerking={standaardAfwerking} afwerkingen={afwerkingen} />
          ) : (
            <span className="text-xs text-slate-300" title="Geen maatwerk-product in deze kwaliteit">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
          <GewichtEditor code={q.code} gewicht={q.gewicht_per_m2_kg} uitwisselbaarCount={uitwisselbaarCount} />
        </td>
        <td className="px-4 py-3 text-right text-slate-500">
          {q.standaard_breedte_cm ? `${q.standaard_breedte_cm} cm` : '—'}
        </td>
        <td className="px-4 py-3 text-right">
          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-xs font-medium">
            {q.aantal_producten}
          </span>
        </td>
      </tr>
      {isExpanded && (
        <KwaliteitKleurenUitvouw kwaliteitCode={q.code} productType={productType} />
      )}
    </>
  )
}

function AfwerkingEditor({ code, huidigeAfwerking, afwerkingen }: {
  code: string
  huidigeAfwerking: string | null
  afwerkingen: AfwerkingTypeRow[]
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; openUp: boolean } | null>(null)

  const setMut = useMutation({
    mutationFn: (afwerkingCode: string) => setStandaardAfwerking(code, afwerkingCode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['standaard-afwerkingen'] })
      qc.invalidateQueries({ queryKey: ['standaard-afwerking', code] })
      setOpen(false)
    },
  })
  const clearMut = useMutation({
    mutationFn: () => clearStandaardAfwerking(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['standaard-afwerkingen'] })
      qc.invalidateQueries({ queryKey: ['standaard-afwerking', code] })
      setOpen(false)
    },
  })

  // Sluit bij klik buiten menu+button, en bij scroll/resize (positie zou stale worden).
  useEffect(() => {
    if (!open) return
    const onMouse = (e: MouseEvent) => {
      const t = e.target as Node
      if (buttonRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onScrollOrResize = () => setOpen(false)
    document.addEventListener('mousedown', onMouse)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', onMouse)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open])

  // Bereken positie op basis van button-rect; flip naar boven als er onder onvoldoende ruimte is.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const menuMaxH = 288 // ~max-h-72
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < Math.min(menuMaxH, 200) && rect.top > spaceBelow
    setPos({
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      openUp,
    })
  }, [open])

  const huidige = afwerkingen.find((a) => a.code === huidigeAfwerking)
  const actieve = afwerkingen.filter((a) => a.actief)

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-sm hover:bg-slate-100',
          huidige ? 'text-slate-800' : 'text-amber-600 italic',
        )}
        title={huidige ? 'Klik om te wijzigen' : 'Nog geen afwerking ingesteld'}
      >
        {huidige ? (
          <>
            <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">{huidige.code}</span>
            <span className="text-xs text-slate-600">{huidige.naam}</span>
          </>
        ) : (
          <>
            <Pencil size={11} />
            <span className="text-xs">instellen</span>
          </>
        )}
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: pos.openUp ? undefined : pos.top,
            bottom: pos.openUp ? window.innerHeight - pos.top : undefined,
            left: pos.left,
          }}
          className="z-[100] bg-white border border-slate-200 rounded-[var(--radius-sm)] shadow-lg min-w-[200px] max-h-72 overflow-y-auto"
        >
          {actieve.map((a) => (
            <button
              key={a.code}
              type="button"
              onClick={() => setMut.mutate(a.code)}
              disabled={setMut.isPending}
              className={cn(
                'block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0',
                huidige?.code === a.code && 'bg-indigo-50/50 font-medium',
              )}
            >
              <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 mr-2">{a.code}</span>
              {a.naam}
            </button>
          ))}
          {huidige && (
            <button
              type="button"
              onClick={() => clearMut.mutate()}
              disabled={clearMut.isPending}
              className="block w-full text-left px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50 border-t border-slate-100"
            >
              Wis afwerking
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}

function GewichtEditor({ code, gewicht, uitwisselbaarCount }: { code: string; gewicht: number | null; uitwisselbaarCount: number }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(gewicht != null ? String(gewicht) : '')
  const [savedTick, setSavedTick] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valueRef = useRef(value)
  valueRef.current = value

  const mutation = useMutation({
    mutationFn: (gewichtPerM2Kg: number | null) => updateKwaliteitGewicht(code, gewichtPerM2Kg),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kwaliteiten-met-gewicht'] })
      queryClient.invalidateQueries({ queryKey: ['producten'] })
      queryClient.invalidateQueries({ queryKey: ['product-detail'] })
      setSavedTick(true)
      setTimeout(() => setSavedTick(false), 1800)
      setEditing(false)
      setError(null)
    },
    onError: (err) => {
      setError(formatError(err))
      console.error(`updateKwaliteitGewicht (${code}) faalde:`, err)
    },
  })

  function commit() {
    const raw = valueRef.current
    const trimmed = raw.trim().replace(',', '.')
    const parsed = trimmed === '' ? null : Number(trimmed)
    if (parsed != null && (Number.isNaN(parsed) || parsed < 0)) {
      setError('Ongeldig getal')
      return
    }
    if (parsed === gewicht) {
      setEditing(false)
      setError(null)
      return
    }
    setError(null)
    mutation.mutate(parsed)
  }

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setValue(gewicht != null ? String(gewicht) : '')
    setError(null)
    setEditing(true)
  }

  if (editing) {
    return (
      <div className="flex flex-col items-end gap-0.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          <input
            autoFocus
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setEditing(false)
                setError(null)
              }
            }}
            disabled={mutation.isPending}
            className="w-20 px-2 py-1 border border-terracotta-300 rounded text-right text-sm focus:outline-none focus:ring-1 focus:ring-terracotta-400 disabled:opacity-60"
          />
          <span className="text-xs text-slate-400">kg</span>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.stopPropagation(); commit() }}
            disabled={mutation.isPending}
            className="p-1 rounded text-emerald-600 hover:bg-emerald-100 disabled:opacity-50"
            title="Opslaan (Enter)"
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.stopPropagation(); setEditing(false); setError(null) }}
            disabled={mutation.isPending}
            className="p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            title="Annuleren (Esc)"
          >
            <X size={14} />
          </button>
        </div>
        {error && (
          <span className="text-xs text-rose-600 max-w-[260px] truncate" title={error}>
            {error}
          </span>
        )}
        {mutation.isPending && (
          <span className="text-xs text-slate-400">Opslaan…</span>
        )}
      </div>
    )
  }

  return (
    <button
      onClick={startEdit}
      className={cn(
        'group inline-flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-slate-100 text-sm',
        gewicht == null ? 'text-amber-600 italic' : 'text-slate-800',
      )}
      disabled={mutation.isPending}
      title={
        uitwisselbaarCount > 0
          ? `Klik om gewicht/m² aan te passen — propageert naar deze kwaliteit + ${uitwisselbaarCount} uitwisselbare ${uitwisselbaarCount === 1 ? 'kwaliteit' : 'kwaliteiten'}`
          : 'Klik om gewicht/m² aan te passen — geldt voor alle producten in deze kwaliteit'
      }
    >
      {gewicht != null ? (
        <>
          {formatNumber(gewicht, 3)} kg
          {savedTick ? (
            <CheckCircle2 size={14} className="text-emerald-600" />
          ) : (
            <Pencil size={12} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
          )}
        </>
      ) : (
        <>
          <AlertCircle size={13} />
          ontbreekt
          <Pencil size={12} className="text-amber-400 group-hover:text-amber-600 transition-colors" />
        </>
      )}
    </button>
  )
}

