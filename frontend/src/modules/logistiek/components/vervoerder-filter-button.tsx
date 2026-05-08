import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Truck } from 'lucide-react'
import { useVervoerders } from '../hooks/use-vervoerders'
import { getVervoerderDef } from '../registry'
import type { ResolvedVervoerder } from '@/modules/magazijn'
import { cn } from '@/lib/utils/cn'

/** Filter-keuzes: 'all' = geen filter, 'afhalen' = alleen afhalen, 'geen' =
 *  zonder effectieve vervoerder, anders is de waarde een vervoerder-code. */
export type VervoerderFilterValue = 'all' | 'afhalen' | 'geen' | string

interface Optie {
  value: VervoerderFilterValue
  label: string
  count: number
}

interface Props {
  /** Effectieve vervoerder per order voor de actuele bucket. Wordt gebruikt om
   *  per optie een telling te tonen (gespiegeld aan de tab-counts). */
  resolvedPerOrder: Map<number, ResolvedVervoerder>
  totaalOrders: number
  value: VervoerderFilterValue
  onChange: (next: VervoerderFilterValue) => void
}

/**
 * Filter-pill voor Pick & Ship — kiest welke vervoerder zichtbaar is.
 *
 * Toont counts per optie zodat de magazijnier ziet welk filter iets oplevert.
 * Vervoerders zonder orders + zonder actief-flag worden weggelaten; afhalen
 * en "geen" verschijnen alleen als ze daadwerkelijk voorkomen of nu geselec-
 * teerd zijn (zodat een lege selectie niet uit de lijst verdwijnt).
 */
export function VervoerderFilterButton({
  resolvedPerOrder,
  totaalOrders,
  value,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const { data: vervoerders = [] } = useVervoerders()

  const opties = useMemo<Optie[]>(() => {
    const codeCount = new Map<string, number>()
    let afhalenCount = 0
    let geenCount = 0
    for (const r of resolvedPerOrder.values()) {
      if (r.afhalen) {
        afhalenCount++
        continue
      }
      if (r.code) {
        codeCount.set(r.code, (codeCount.get(r.code) ?? 0) + 1)
      } else {
        geenCount++
      }
    }
    const list: Optie[] = []
    list.push({ value: 'all', label: 'Alle vervoerders', count: totaalOrders })
    for (const v of vervoerders) {
      const c = codeCount.get(v.code) ?? 0
      if (!v.actief && c === 0 && value !== v.code) continue
      list.push({ value: v.code, label: v.display_naam, count: c })
    }
    if (afhalenCount > 0 || value === 'afhalen') {
      list.push({ value: 'afhalen', label: 'Afhalen', count: afhalenCount })
    }
    if (geenCount > 0 || value === 'geen') {
      list.push({ value: 'geen', label: 'Geen / handmatig', count: geenCount })
    }
    return list
  }, [resolvedPerOrder, vervoerders, totaalOrders, value])

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const huidigLabel =
    value === 'all'
      ? 'Vervoerder'
      : value === 'afhalen'
        ? 'Afhalen'
        : value === 'geen'
          ? 'Geen / handmatig'
          : (getVervoerderDef(value)?.displayNaam ?? value)

  const isFiltering = value !== 'all'

  return (
    <div className="relative inline-block" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-pressed={isFiltering}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors',
          isFiltering
            ? 'bg-teal-100 text-teal-800 ring-1 ring-teal-300'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
        )}
      >
        <Truck size={14} />
        {huidigLabel}
        <ChevronDown size={12} className="opacity-70" />
      </button>
      {open && (
        <div className="absolute left-0 mt-1 w-56 rounded-[var(--radius-sm)] border border-slate-200 bg-white shadow-lg z-20 py-1 text-xs">
          {opties.map((opt) => {
            const isSel = value === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  'w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center justify-between gap-2',
                  isSel && 'bg-slate-50 font-medium',
                )}
              >
                <span>{opt.label}</span>
                <span className="text-slate-400">{opt.count}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
