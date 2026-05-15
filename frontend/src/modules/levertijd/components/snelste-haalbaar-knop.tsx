// "Klant heeft haast"-knop met popover (ADR-0020 stap 6).
//
// Klik = manuele `refetch()` op `useSnelsteHaalbaar(regelIds)` — die hook
// staat default `enabled: false` zodat we pas RPC-vragen bij operator-intentie.
// Resultaat verschijnt in een popover, één rij per regel met de
// `snelste_haalbaar`-week + `spoed_uitleg`. Per regel een "Overnemen"-knop.
//
// Overnemen-pad scheidt twee modes via `orderId`:
//   - `orderId !== null` (edit-mode): caller-component kan in `onOvernemen`
//     `useNeemSnelsteOver()` aanroepen om `orders.afleverdatum` server-side
//     te muteren (trigger uit mig 276 zet `levertijd_status`).
//   - `orderId === null` (create-mode): caller past lokaal de afleverdatum-
//     state aan via `verzendWeekStringToDatum(gekozenWeek)` — geen DB-write.
//
// Component zelf is dom: één callback `onOvernemen(week)`, caller bepaalt het
// schrijfpad. Geen state-leakage, geen impliciete mutaties.

import { useState, useRef, useEffect } from 'react'
import { Zap, X } from 'lucide-react'
import { useSnelsteHaalbaar } from '../hooks/use-snelste-haalbaar'
import { cn } from '@/lib/utils/cn'

interface Props {
  /** null = nieuwe order (caller past lokale state aan); ≠ null = edit-mode. */
  orderId: number | null
  /** Regels waarvoor snelste-haalbaar opgehaald moet worden. */
  regelIds: number[]
  /** Aangeroepen wanneer operator een week wil overnemen. */
  onOvernemen: (gekozenWeek: string) => void
}

function weekNummer(iso: string | null | undefined): string | null {
  if (!iso) return null
  const m = iso.match(/^\d{4}-W(\d{1,2})$/)
  return m ? m[1].replace(/^0+/, '') || '0' : null
}

export function SnelsteHaalbaarKnop({ orderId: _orderId, regelIds, onOvernemen }: Props) {
  // `_orderId` is bewust ongebruikt in deze component — de hook leeft bij de
  // caller, want create vs edit gebruiken verschillende schrijfpaden. We
  // exposen 'm wel in de props zodat de Props-vorm uit ADR-0020 stabiel blijft
  // én callers expliciet de mode communiceren bij invocation.
  void _orderId

  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const query = useSnelsteHaalbaar(regelIds)
  const disabled = regelIds.length === 0

  // Sluit popover bij klik buiten.
  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  async function handleKnopKlik() {
    if (disabled) return
    setOpen(true)
    await query.refetch()
  }

  function handleOvernemen(week: string) {
    onOvernemen(week)
    setOpen(false)
  }

  return (
    <div ref={popoverRef} className="relative inline-block">
      <button
        type="button"
        onClick={handleKnopKlik}
        disabled={disabled}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)]',
          'text-xs font-medium border transition-colors',
          'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
        title={
          disabled
            ? 'Voeg eerst orderregels toe om de snelste haalbare levertijd te bepalen'
            : undefined
        }
      >
        <Zap size={13} aria-hidden />
        <span>Klant heeft haast — toon snelste haalbare</span>
      </button>

      {open && (
        <div
          className={cn(
            'absolute z-30 mt-2 right-0 w-96 max-w-[calc(100vw-2rem)]',
            'bg-white border border-slate-200 rounded-[var(--radius)] shadow-lg',
          )}
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
            <div className="text-sm font-medium text-slate-800">
              Snelste haalbare per regel
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-slate-700"
              aria-label="Sluiten"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-3 text-sm">
            {query.isFetching && (
              <div className="text-xs text-slate-500 py-2">Bezig met ophalen…</div>
            )}
            {query.error && (
              <div className="text-xs text-rose-600 py-2">
                Kon snelste haalbare niet ophalen.
              </div>
            )}
            {!query.isFetching && !query.error && (!query.data || query.data.length === 0) && (
              <div className="text-xs text-slate-500 py-2">
                Geen suggesties beschikbaar.
              </div>
            )}
            {!query.isFetching && !query.error && query.data && query.data.length > 0 && (
              <ul className="space-y-2">
                {query.data.map((res) => {
                  const week = weekNummer(res.snelste_haalbaar)
                  return (
                    <li
                      key={res.regel_id}
                      className="flex items-start justify-between gap-3 border border-slate-100 bg-slate-50 rounded-[var(--radius-sm)] p-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-slate-800">
                          Regel #{res.regel_id} — snelste: wk {week ?? res.snelste_haalbaar}
                        </div>
                        {res.spoed_uitleg && (
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {res.spoed_uitleg}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOvernemen(res.snelste_haalbaar)}
                        className={cn(
                          'shrink-0 px-2.5 py-1 rounded-[var(--radius-sm)] text-xs font-medium',
                          'bg-terracotta-500 text-white hover:bg-terracotta-600 transition-colors',
                        )}
                      >
                        Overnemen
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
