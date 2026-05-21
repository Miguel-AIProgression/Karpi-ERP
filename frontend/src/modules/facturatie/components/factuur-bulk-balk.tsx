import { useEffect, useRef, useState } from 'react'
import { ChevronDown, X, Loader2 } from 'lucide-react'
import { StatusBadge } from '@/components/ui/status-badge'
import { useZetFactuurStatusBulk } from '../hooks/use-facturen'
import type { FactuurStatus } from '../queries/facturen'

const STATUS_OPTIES: FactuurStatus[] = [
  'Concept',
  'Verstuurd',
  'Betaald',
  'Herinnering',
  'Aanmaning',
  'Gecrediteerd',
]

interface FactuurBulkBalkProps {
  geselecteerdeIds: number[]
  onClear: () => void
  onKlaar?: () => void
}

export function FactuurBulkBalk({ geselecteerdeIds, onClear, onKlaar }: FactuurBulkBalkProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const mutatie = useZetFactuurStatusBulk()

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function kies(status: FactuurStatus) {
    setOpen(false)
    if (geselecteerdeIds.length === 0) return
    const bevestiging = window.confirm(
      `${geselecteerdeIds.length} factuur(en) wijzigen naar status "${status}"?`,
    )
    if (!bevestiging) return
    mutatie.mutate(
      { ids: geselecteerdeIds, status },
      {
        onSuccess: () => {
          onKlaar?.()
        },
      },
    )
  }

  if (geselecteerdeIds.length === 0) return null

  return (
    <div className="flex items-center gap-3 mb-3 px-4 py-2.5 rounded-[var(--radius-sm)] border border-terracotta-300 bg-terracotta-50">
      <span className="text-sm font-medium text-slate-800">
        {geselecteerdeIds.length} geselecteerd
      </span>

      <div ref={wrapperRef} className="relative ml-auto">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={mutatie.isPending}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-sm)] bg-white border border-terracotta-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {mutatie.isPending ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Bezig…
            </>
          ) : (
            <>
              Status wijzigen
              <ChevronDown size={14} className="text-slate-400" />
            </>
          )}
        </button>

        {open && (
          <div className="absolute z-30 right-0 top-full mt-1 w-48 rounded-md border border-slate-200 bg-white shadow-lg py-1">
            {STATUS_OPTIES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => kies(s)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 text-left"
              >
                <StatusBadge status={s} type="factuur" />
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onClear}
        disabled={mutatie.isPending}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
      >
        <X size={14} />
        Wis selectie
      </button>
    </div>
  )
}
