import { useState, useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useClaimsVoorOrderRegel } from '../hooks/use-reserveringen'
import { isoWeekFromString } from '@/lib/utils/iso-week'
import { InkoopRegelSamenvatting } from '@/modules/inkoop'

interface Props {
  orderRegelId: number
  children: React.ReactNode
}

/** Toont per orderregel de claim-uitsplitsing in een lichte popover. */
export function RegelClaimDetail({ orderRegelId, children }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { data, isLoading } = useClaimsVoorOrderRegel(open ? orderRegelId : undefined)

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
        <div className="absolute z-30 left-0 top-full mt-1 w-80 rounded-md border border-slate-200 bg-white shadow-lg p-3 text-left">
          <div className="text-xs font-medium text-slate-700 mb-2">Levering uit</div>
          {isLoading && <Loader2 className="animate-spin" size={14} />}
          {!isLoading && (!data || data.length === 0) && (
            <div className="text-sm text-slate-500">Geen claims (wacht op nieuwe inkoop)</div>
          )}
          {!isLoading && data?.map(c => {
            // Cross-Module: IO-claim-rij toont Inkoop's eigen slot — Reservering
            // kent inkooporder/leverancier/status niet, slot self-fetcht.
            const isIoClaim =
              c.bron === 'inkooporder_regel' && c.inkooporder_regel_id !== null
            return (
              <div key={c.id} className="flex justify-between text-sm py-0.5 gap-2">
                <span className="flex-1 min-w-0">
                  {isIoClaim ? (
                    <InkoopRegelSamenvatting ioRegelId={c.inkooporder_regel_id!} />
                  ) : (
                    <>
                      {c.bron === 'voorraad'
                        ? (c.is_handmatig
                            ? <>Voorraad <span className="text-amber-600">(omstickeren {c.fysiek_artikelnr})</span></>
                            : 'Voorraad')
                        : (c.inkooporder_nr ?? `IO #${c.inkooporder_regel_id}`)}
                      {c.verwacht_datum && (
                        <span className="text-slate-500"> · wk {isoWeekFromString(c.verwacht_datum)}</span>
                      )}
                    </>
                  )}
                </span>
                <span className="font-medium whitespace-nowrap">{c.aantal}×</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
