// StartWeekButton — start in één handeling álle pickbare orders van één
// verzendweek-sectie (Pick & Ship) en navigeer naar de bulk-printset, waar
// labels en pakbonnen als gescheiden stapels (per printer) geprint worden.
//
// Verschil met StartPickrondesButton (cluster/land-niveau): dit is bewust een
// "hele week"-actie. De RPC start_pickronden bundelt zelf auto-4D, dus uit N
// orders ontstaan meestal MEERDERE zendingen — de copy zegt dat ook, i.t.t. de
// cluster-knop die over één bundel praat. Geen per-order force-solo hier: op
// weekniveau zou dat een onhanteerbaar lange lijst zijn; de operator stuurt
// desgewenst per cluster bij met de bestaande Verzendset-knop of de multi-select.
//
// Eén klik, geen picker (besluit 2026-06-17): het magazijn print met één
// persoon de hele stapel en verdeelt het werk daarna over de dagen — een picker
// per order kiezen was onnodige wrijving. `picker_id` blijft NULL (mig 394).
//
// Pickbaarheid-/vervoerder-/intake-resolutie loopt via de gedeelde
// `usePickbaarheid`-hook (zelfde filtering als StartPickrondesButton en de
// bulk-actiebalk) — inclusief de intake-gates (mig 395/396), zodat een
// adres-/prijs-geblokkeerde order de hele week-start niet laat falen.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Printer } from 'lucide-react'
import { useStartPickrondes } from '../hooks/use-zendingen'
import { useVervoerders } from '../hooks/use-vervoerders'
import { usePickbaarheid } from '../hooks/use-pickbaarheid'
import { printsetPadVoorZendingen } from '../lib/printset-navigatie'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils/cn'
import type { PickShipOrder } from '@/modules/magazijn'

interface Props {
  /** Alle orders van deze verzendweek-sectie (pickbaar of niet — wordt gefilterd). */
  orders: PickShipOrder[]
  /** Weeknummer voor label/tooltip. */
  verzendWeek: number | null
}

export function StartWeekButton({ orders, verzendWeek }: Props) {
  const navigate = useNavigate()
  const mutation = useStartPickrondes()
  const { data: vervoerders = [] } = useVervoerders()
  const [error, setError] = useState<string | null>(null)

  const { pickbareOrders, aantalGeblokkeerd, vervoerderResolutieLaadt } =
    usePickbaarheid(orders)
  // Externe vertegenwoordiger (mig 489): read-only — geen week-start.
  const { isExternRep } = useAuth()

  if (isExternRep) return null

  const aantal = pickbareOrders.length

  const heeftVerzend = pickbareOrders.some((o) => !o.afhalen)
  const heeftActieveVervoerder = vervoerders.some((v) => v.actief)
  const vervoerderOk = !heeftVerzend || heeftActieveVervoerder
  const disabled =
    mutation.isPending || aantal === 0 || !vervoerderOk || vervoerderResolutieLaadt

  const weekLabel = verzendWeek !== null ? `week ${verzendWeek}` : 'deze week'

  async function handleStart() {
    if (disabled) return
    setError(null)
    try {
      const zendingen = await mutation.mutateAsync({
        orderIds: pickbareOrders.map((o) => o.order_id),
        pickerId: null,
        forceSoloIds: [],
      })
      navigate(printsetPadVoorZendingen(zendingen))
    } catch (err) {
      setError(readErrorMessage(err))
    }
  }

  const tooltip = !vervoerderOk
    ? 'Activeer eerst minstens één vervoerder bij Logistiek > Vervoerders'
    : aantal === 0
      ? `Niets pickbaar in ${weekLabel}`
      : `Start alle ${aantal} pickbare orders van ${weekLabel} — worden automatisch gebundeld${
          aantalGeblokkeerd > 0
            ? ` (${aantalGeblokkeerd} overgeslagen — geen vervoerder / adres / prijs)`
            : ''
        }`

  return (
    <div className="relative inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleStart}
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
      {error && <div className="max-w-72 text-right text-[11px] text-rose-600">{error}</div>}
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
