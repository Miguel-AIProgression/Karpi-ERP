// StartWeekButton — start in één handeling álle pickbare orders van één
// verzendweek-sectie (Pick & Ship) en navigeer naar de bulk-printset, waar
// labels en pakbonnen als gescheiden stapels (per printer) geprint worden.
//
// Verschil met StartPickrondesButton (cluster/land-niveau): dit is bewust een
// "hele week"-actie. De RPC start_pickronden bundelt zelf auto-4D, dus uit N
// orders ontstaan meestal MEERDERE zendingen — de copy zegt dat ook, i.t.t. de
// cluster-knop die over één bundel praat. Geen per-order force-solo hier: op
// weekniveau zou dat een onhanteerbaar lange lijst zijn; de operator stuurt
// desgewenst per cluster bij met de bestaande Verzendset-knop.
//
// Picker is optioneel (mig 394) — alleen voor de audit-trail.
//
// NB: de pickbaarheid-/vervoerder-resolutie spiegelt StartPickrondesButton.
// Bewust niet (nu) geëxtraheerd naar een gedeelde hook omdat StartPickrondesButton
// op een parallelle branch zwaar wijzigt (intake-gates) — consolidatie volgt na
// die merge.
import { useMemo, useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { Loader2, Printer, X } from 'lucide-react'
import { useStartPickrondes } from '../hooks/use-zendingen'
import { useVervoerders } from '../hooks/use-vervoerders'
import { fetchEffectieveVervoerderPerOrderregel } from '../queries/orderregel-vervoerder'
import { PickerDropdown } from '@/components/orders/picker-dropdown'
import { cn } from '@/lib/utils/cn'
import type { PickShipOrder } from '@/modules/magazijn'

interface Props {
  /** Alle orders van deze verzendweek-sectie (pickbaar of niet — wordt gefilterd). */
  orders: PickShipOrder[]
  /** Weeknummer voor label/tooltip. */
  verzendWeek: number | null
}

const LAST_PICKER_KEY = 'rugflow.last-picker-id'

function loadLastPicker(): number | null {
  try {
    const v = localStorage.getItem(LAST_PICKER_KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

function saveLastPicker(id: number) {
  try {
    localStorage.setItem(LAST_PICKER_KEY, String(id))
  } catch {
    /* ignore */
  }
}

function isPickbaar(o: PickShipOrder): boolean {
  if (o.actieve_pickronde) return false
  return o.alle_regels_pickbaar
}

export function StartWeekButton({ orders, verzendWeek }: Props) {
  const navigate = useNavigate()
  const mutation = useStartPickrondes()
  const { data: vervoerders = [] } = useVervoerders()
  const [showPopover, setShowPopover] = useState(false)
  const [pickerId, setPickerId] = useState<number | null>(loadLastPicker())
  const [error, setError] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showPopover) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPopover])

  // Per-order vervoerder-resolutie (cache-hit met de VervoerderTag op de cards):
  // een niet-afhaal-order met ≥1 regel bron='geen' mag niet starten (server-side
  // gespiegeld in start_pickronden, mig 373) — anders faalt de hele week-start.
  const verzendOrders = useMemo(() => orders.filter((o) => !o.afhalen), [orders])
  const vervoerderQueries = useQueries({
    queries: verzendOrders.map((o) => ({
      queryKey: ['logistiek', 'orderregel-vervoerder', o.order_id],
      queryFn: () => fetchEffectieveVervoerderPerOrderregel(o.order_id),
      staleTime: 30_000,
    })),
  })
  const geenVervoerderIds = useMemo(() => {
    const set = new Set<number>()
    verzendOrders.forEach((o, i) => {
      const regels = vervoerderQueries[i]?.data
      if (regels?.some((r) => r.bron === 'geen')) set.add(o.order_id)
    })
    return set
  }, [verzendOrders, vervoerderQueries])
  const vervoerderResolutieLaadt = vervoerderQueries.some((q) => q.isLoading)

  const pickbareOrders = useMemo(
    () => orders.filter((o) => isPickbaar(o) && !geenVervoerderIds.has(o.order_id)),
    [orders, geenVervoerderIds],
  )
  const aantal = pickbareOrders.length
  const aantalGeblokkeerd = useMemo(
    () => orders.filter((o) => isPickbaar(o) && geenVervoerderIds.has(o.order_id)).length,
    [orders, geenVervoerderIds],
  )

  const heeftVerzend = pickbareOrders.some((o) => !o.afhalen)
  const heeftActieveVervoerder = vervoerders.some((v) => v.actief)
  const vervoerderOk = !heeftVerzend || heeftActieveVervoerder
  const disabled = mutation.isPending || aantal === 0 || !vervoerderOk || vervoerderResolutieLaadt

  const weekLabel = verzendWeek !== null ? `week ${verzendWeek}` : 'deze week'

  async function handleStart() {
    setError(null)
    if (pickerId) saveLastPicker(pickerId)
    try {
      const zendingen = await mutation.mutateAsync({
        orderIds: pickbareOrders.map((o) => o.order_id),
        pickerId,
        forceSoloIds: [],
      })
      setShowPopover(false)
      if (zendingen.length === 1) {
        navigate(`/logistiek/${zendingen[0].zending_nr}/printset`)
      } else {
        const qs = encodeURIComponent(zendingen.map((z) => z.zending_nr).join(','))
        navigate(`/logistiek/printset/bulk?zendingen=${qs}`)
      }
    } catch (err) {
      setError(readErrorMessage(err))
    }
  }

  const tooltip = !vervoerderOk
    ? 'Activeer eerst minstens één vervoerder bij Logistiek > Vervoerders'
    : aantal === 0
      ? `Niets pickbaar in ${weekLabel}`
      : `Start alle ${aantal} pickbare orders van ${weekLabel} — worden automatisch gebundeld`

  return (
    <div className="relative inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => {
          setError(null)
          setShowPopover((v) => !v)
        }}
        disabled={disabled}
        title={tooltip}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-terracotta-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-terracotta-600',
          'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-terracotta-500',
        )}
      >
        {mutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
        Hele week starten &amp; printen{aantal > 0 ? ` (${aantal})` : ''}
      </button>

      {showPopover && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full z-30 mt-1 w-80 rounded-[var(--radius)] border border-slate-200 bg-white p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-700">
              Hele {weekLabel} starten
            </div>
            <button
              onClick={() => setShowPopover(false)}
              className="text-slate-400 hover:text-slate-700"
            >
              <X size={14} />
            </button>
          </div>

          <p className="mb-3 text-[11px] leading-relaxed text-slate-600">
            Start <strong>{aantal}</strong> pickbare order{aantal === 1 ? '' : 's'} van {weekLabel}.
            Ze worden automatisch gebundeld op adres + vervoerder, dus dit maakt meestal
            meerdere zendingen. Daarna print je de labels en de pakbonnen als aparte stapels.
            {aantalGeblokkeerd > 0 && (
              <>
                {' '}
                <span className="text-amber-700">
                  {aantalGeblokkeerd} order{aantalGeblokkeerd === 1 ? '' : 's'} overgeslagen (geen vervoerder).
                </span>
              </>
            )}
          </p>

          <PickerDropdown value={pickerId} onChange={setPickerId} placeholder="Picker (optioneel)…" />

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              onClick={() => setShowPopover(false)}
              disabled={mutation.isPending}
              className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 disabled:opacity-45"
            >
              Annuleren
            </button>
            <button
              type="button"
              onClick={handleStart}
              disabled={mutation.isPending || aantal === 0}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-terracotta-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-terracotta-600 disabled:opacity-45"
            >
              {mutation.isPending && <Loader2 size={12} className="animate-spin" />}
              Start &amp; print
            </button>
          </div>
          {error && <div className="mt-2 text-[11px] text-rose-600">{error}</div>}
        </div>
      )}
    </div>
  )
}

function readErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>
    const parts = [obj.message, obj.details, obj.hint, obj.code].filter(
      (part): part is string => typeof part === 'string' && part.trim().length > 0,
    )
    if (parts.length > 0) return parts.join(' ')
  }
  return String(err)
}
