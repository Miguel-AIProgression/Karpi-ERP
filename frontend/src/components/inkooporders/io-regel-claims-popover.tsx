import { useState, useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useClaimsVoorIORegel } from '@/hooks/use-reserveringen'

interface Props {
  ioRegelId: number
  children: React.ReactNode
}

/** Toont per IO-regel welke orderregels een claim hebben. */
export function IORegelClaimsPopover({ ioRegelId, children }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { data, isLoading } = useClaimsVoorIORegel(open ? ioRegelId : undefined)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="cursor-pointer"
      >
        {children}
      </button>
      {open && (
        <div className="absolute z-30 right-0 top-full mt-1 w-80 rounded-md border border-slate-200 bg-white shadow-lg p-3 text-left">
          <div className="text-xs font-medium text-slate-700 mb-2">Geclaimd door</div>
          {isLoading && <Loader2 className="animate-spin" size={14} />}
          {!isLoading && (!data || data.length === 0) && (
            <div className="text-sm text-slate-500">Nog geen orders op deze regel.</div>
          )}
          {!isLoading && data?.map(c => (
            <div key={c.id} className="flex justify-between text-sm py-0.5 gap-2">
              <span className="truncate">
                <span className="font-medium">{c.order_nr}</span>
                <span className="text-slate-500"> — {c.klant_naam ?? `Klant ${c.debiteur_nr ?? '?'}`}</span>
              </span>
              <span className="font-medium shrink-0">{c.aantal}×</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
