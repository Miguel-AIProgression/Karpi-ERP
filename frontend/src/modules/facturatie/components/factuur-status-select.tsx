import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { StatusBadge } from '@/components/ui/status-badge'
import { useZetFactuurStatus } from '../hooks/use-facturen'
import type { FactuurStatus } from '../queries/facturen'
import { useAuth } from '@/hooks/use-auth'

const STATUS_OPTIES: FactuurStatus[] = [
  'Concept',
  'Verstuurd',
  'Betaald',
  'Herinnering',
  'Aanmaning',
  'Gecrediteerd',
]

interface FactuurStatusSelectProps {
  factuurId: number
  status: FactuurStatus
}

export function FactuurStatusSelect({ factuurId, status }: FactuurStatusSelectProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const mutatie = useZetFactuurStatus()
  // Externe vertegenwoordiger (mig 489): read-only — toon de status als badge zonder edit-trigger.
  const { isExternRep } = useAuth()

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

  function kies(nieuw: FactuurStatus) {
    setOpen(false)
    if (nieuw === status) return
    mutatie.mutate({ id: factuurId, status: nieuw })
  }

  // Read-only: laat de waarde (badge) staan, verberg de wijzig-trigger.
  if (isExternRep) {
    return <StatusBadge status={status} type="factuur" />
  }

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={mutatie.isPending}
        className="inline-flex items-center gap-1 rounded-full hover:ring-2 hover:ring-terracotta-400/30 transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
        title="Klik om status te wijzigen"
      >
        <StatusBadge status={status} type="factuur" />
        <ChevronDown size={12} className="text-slate-400" />
      </button>

      {open && (
        <div className="absolute z-30 right-0 top-full mt-1 w-48 rounded-md border border-slate-200 bg-white shadow-lg py-1">
          {STATUS_OPTIES.map((optie) => {
            const actief = optie === status
            return (
              <button
                key={optie}
                type="button"
                onClick={() => kies(optie)}
                className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 text-left"
              >
                <StatusBadge status={optie} type="factuur" />
                {actief && <Check size={14} className="text-terracotta-500" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
