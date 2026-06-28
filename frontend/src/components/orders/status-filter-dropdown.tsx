import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export interface StatusOptie {
  value: string
  count: number
}

interface StatusFilterDropdownProps {
  selected: string
  /** Inclusief 'Alle' als eerste optie. */
  options: StatusOptie[]
  onSelect: (status: string) => void
}

/** Single-select status-filter met count per optie — vervangt de scrollende
 *  status-chiprij. Stijl spiegelt MultiSelectDropdown (Alle klanten/kanalen). */
export function StatusFilterDropdown({ selected, options, onSelect }: StatusFilterDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const huidige = options.find((o) => o.value === selected)
  const isFilter = selected !== 'Alle'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 py-2 px-3 rounded-[var(--radius-sm)] border text-sm bg-white focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400 transition-colors',
          isFilter ? 'border-terracotta-400 text-slate-800' : 'border-slate-200 text-slate-700',
        )}
      >
        <span className="text-left whitespace-nowrap">
          Status: <span className="font-medium">{selected}</span>
          {huidige ? <span className="text-slate-400"> ({huidige.count})</span> : null}
        </span>
        <ChevronDown size={14} className="text-slate-400" />
      </button>

      {open && (
        <div className="absolute z-30 left-0 top-full mt-1 w-64 rounded-md border border-slate-200 bg-white shadow-lg py-1 max-h-80 overflow-y-auto">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onSelect(o.value)
                setOpen(false)
              }}
              className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 text-left"
            >
              <span className="flex items-center gap-2 text-slate-700">
                <Check
                  size={14}
                  className={o.value === selected ? 'text-terracotta-500' : 'text-transparent'}
                />
                {o.value}
              </span>
              <span className="text-xs text-slate-400 tabular-nums">{o.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
