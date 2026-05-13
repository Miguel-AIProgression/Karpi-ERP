import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'

export interface MultiSelectOption {
  value: string
  label: string
}

interface MultiSelectDropdownProps {
  /** Knop-label als er niets geselecteerd is, bv "Alle statussen". */
  placeholder: string
  options: MultiSelectOption[]
  /** Lege array = geen filter (alles zichtbaar). */
  selected: string[]
  onChange: (next: string[]) => void
  /** Optionele zoekbalk binnen de dropdown. Standaard aan ≥10 opties. */
  zoekbaar?: boolean
  className?: string
}

export function MultiSelectDropdown({
  placeholder,
  options,
  selected,
  onChange,
  zoekbaar,
  className = '',
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false)
  const [zoekterm, setZoekterm] = useState('')
  const wrapperRef = useRef<HTMLDivElement>(null)

  const toonZoek = zoekbaar ?? options.length >= 10

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
        setZoekterm('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const zichtbareOpties = useMemo(() => {
    const q = zoekterm.trim().toLowerCase()
    if (!q) return options
    // Zoek in label én value — voor klant-filter dekt dat zowel naam als
    // debiteur-nummer in één veld.
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q),
    )
  }, [options, zoekterm])

  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    )
  }

  function wis(e: React.MouseEvent) {
    e.stopPropagation()
    onChange([])
  }

  const knopTekst =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? placeholder)
        : `${selected.length} geselecteerd`

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 py-2 px-3 rounded-[var(--radius-sm)] border text-sm bg-white focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400 transition-colors ${
          selected.length > 0
            ? 'border-terracotta-400 text-slate-800'
            : 'border-slate-200 text-slate-700'
        }`}
      >
        <span className="truncate max-w-[220px] text-left">{knopTekst}</span>
        {selected.length > 0 ? (
          <span
            role="button"
            tabIndex={-1}
            onClick={wis}
            className="text-slate-400 hover:text-slate-700 cursor-pointer"
            aria-label="Selectie wissen"
          >
            <X size={14} />
          </span>
        ) : (
          <ChevronDown size={14} className="text-slate-400" />
        )}
      </button>

      {open && (
        <div className="absolute z-30 left-0 top-full mt-1 w-64 rounded-md border border-slate-200 bg-white shadow-lg py-1 text-left">
          {toonZoek && (
            <div className="px-2 pb-1 pt-1 border-b border-slate-100">
              <input
                type="text"
                value={zoekterm}
                onChange={(e) => setZoekterm(e.target.value)}
                placeholder="Zoeken…"
                className="w-full px-2 py-1 text-sm rounded border border-slate-200 focus:outline-none focus:border-terracotta-400"
                autoFocus
              />
            </div>
          )}
          <div className="max-h-72 overflow-y-auto">
            {zichtbareOpties.length === 0 && (
              <div className="px-3 py-2 text-xs text-slate-400">Geen resultaten</div>
            )}
            {zichtbareOpties.map((o) => {
              const aan = selected.includes(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 text-left"
                >
                  <input
                    type="checkbox"
                    checked={aan}
                    onChange={() => {}}
                    tabIndex={-1}
                    className="h-4 w-4 rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400/30 pointer-events-none flex-shrink-0"
                  />
                  <span className="truncate text-slate-700">{o.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
