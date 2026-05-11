// StartPickrondesButton — canonieke entry voor pickronde-start (ADR-0012, mig 248).
//
// Vervangt zowel `<VerzendsetButton order={order}>` (op order-card) als
// `<BulkVerzendsetButton orders={cluster.orders}>` (op cluster-card). Eén knop,
// één dialog, één RPC (`start_pickronden`). Auto-4D-bundeling is default-on
// in de RPC; de dialog toont per order een checkbox zodat de operator orders
// uit de bundel kan halen vóór start (force_solo_ids).
//
// Twee varianten:
//   - 'compact'   (standaard op order-card): klein, slate-900, "Verzendset"/"Afhaalset"
//   - 'prominent' (standaard op cluster-card): terracotta, "Bundel printen (N)"
//
// Voor solo (1 order): checkbox niet beschikbaar — er valt niks te bundelen.
// Voor bundel (≥2 orders): elke checkbox uitvinken = die order solo via
// p_force_solo_ids; aangevinkt = bundel-mee. Voor `voorgesteldeBundel` met
// besparing-info: tonen we de besparing als pijl in de dialog-kop.
//
// Mig 217 — picker-dropdown met `last-picker-id`-recall via localStorage.
import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Printer, PackageCheck, TrendingDown, X } from 'lucide-react'
import { useStartPickrondes } from '../hooks/use-zendingen'
import { useVervoerders } from '../hooks/use-vervoerders'
import { PickerDropdown } from '@/components/orders/picker-dropdown'
import { formatCurrency } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import type { PickShipOrder } from '@/modules/magazijn'
import type { VoorgesteldeBundel } from '../queries/voorgestelde-bundels'

interface StartPickrondesButtonProps {
  /** Orders die de operator wil starten. Voor solo: één order; voor bundel: ≥2. */
  orders: PickShipOrder[]
  /** Optioneel: extra tooltip-suffix, bv. "voor klant X" of "voor 🇳🇱 NL". */
  context?: string
  /** Compact = op order-card (klein, slate-900). Prominent = op cluster-card (terracotta). */
  variant?: 'compact' | 'prominent'
  /** Voorgestelde bundel uit `voorgestelde_zending_bundels` — drijft de besparing-display. */
  voorgesteldeBundel?: VoorgesteldeBundel | null
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
  if (o.regels.length === 0) return false
  if (o.actieve_pickronde) return false
  return o.regels.every((r) => r.is_pickbaar)
}

export function StartPickrondesButton({
  orders,
  context,
  variant = 'prominent',
  voorgesteldeBundel = null,
}: StartPickrondesButtonProps) {
  const navigate = useNavigate()
  const mutation = useStartPickrondes()
  const { data: vervoerders = [] } = useVervoerders()
  const [error, setError] = useState<string | null>(null)
  const [showPopover, setShowPopover] = useState(false)
  const [pickerId, setPickerId] = useState<number | null>(loadLastPicker())
  const [forceSoloIds, setForceSoloIds] = useState<Set<number>>(new Set())
  const popoverRef = useRef<HTMLDivElement>(null)

  // Bij elke heropening van de popover de force-solo-state resetten — anders
  // hangt een eerdere uitvink-keuze rond na annuleren.
  useEffect(() => {
    if (!showPopover) setForceSoloIds(new Set())
  }, [showPopover])

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

  const pickbareOrders = useMemo(() => orders.filter(isPickbaar), [orders])
  const aantal = pickbareOrders.length
  const aantalOverig = orders.length - aantal
  const heeftAfhalen = pickbareOrders.some((o) => o.afhalen)
  const heeftVerzend = pickbareOrders.some((o) => !o.afhalen)
  const heeftActieveVervoerder = vervoerders.some((v) => v.actief)
  const vervoerderOk = !heeftVerzend || heeftActieveVervoerder
  const isBundel = pickbareOrders.length >= 2

  const niksTeDoen = aantal === 0
  const disabled = mutation.isPending || !vervoerderOk || niksTeDoen

  const aantalInBundel = isBundel ? aantal - forceSoloIds.size : 0
  const aantalSolo = isBundel ? forceSoloIds.size : aantal

  // Tooltip-tekst — context-aware.
  const tooltip = !vervoerderOk
    ? 'Activeer eerst minstens één vervoerder bij Logistiek > Vervoerders'
    : niksTeDoen
      ? 'Geen pickbare orders in deze groep — eerst voorraad/snijden/confectie afronden'
      : isBundel
        ? `Bundel ${aantal} zendingen${context ? ` ${context}` : ''}${
            aantalOverig > 0 ? ` (${aantalOverig} overgeslagen — nog niet pickbaar)` : ''
          }. ${
            voorgesteldeBundel && voorgesteldeBundel.bundel_besparing > 0
              ? `Bespaart ${formatCurrency(voorgesteldeBundel.bundel_besparing)} verzendkosten.`
              : 'Operator kan in de dialog orders uit de bundel halen.'
          }`
        : pickbareOrders[0]?.afhalen
          ? 'Start afhaal-pickronde (geen verzendstickers)'
          : 'Start pickronde — kies eerst de picker, daarna print stickers en pakbon'

  function openPopover() {
    setError(null)
    setShowPopover(true)
  }

  function toggleForceSolo(orderId: number) {
    setForceSoloIds((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) {
        next.delete(orderId)
      } else {
        next.add(orderId)
      }
      return next
    })
  }

  async function handleStart() {
    if (!pickerId) {
      setError('Kies eerst een picker')
      return
    }
    setError(null)
    saveLastPicker(pickerId)
    try {
      const zendingen = await mutation.mutateAsync({
        orderIds: pickbareOrders.map((o) => o.order_id),
        pickerId,
        forceSoloIds: Array.from(forceSoloIds),
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

  const knopLabel = isBundel
    ? aantalOverig > 0
      ? `Bundel printen (${aantal} van ${orders.length})`
      : `Bundel printen (${aantal})`
    : pickbareOrders[0]?.afhalen
      ? 'Afhaalset'
      : 'Verzendset'

  const knopIcon = mutation.isPending ? (
    <Loader2 size={13} className="animate-spin" />
  ) : isBundel ? (
    <Printer size={13} />
  ) : pickbareOrders[0]?.afhalen ? (
    <PackageCheck size={13} />
  ) : (
    <Printer size={13} />
  )

  const buttonClass =
    variant === 'compact'
      ? cn(
          'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800',
          'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-slate-900',
        )
      : cn(
          'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-terracotta-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-terracotta-600',
          'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-terracotta-500',
        )

  return (
    <div className="relative inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={openPopover}
        disabled={disabled}
        title={tooltip}
        className={buttonClass}
      >
        {knopIcon}
        {niksTeDoen ? 'Niets pickbaar' : knopLabel}
      </button>
      {error && <div className="max-w-72 text-right text-[11px] text-rose-600">{error}</div>}

      {showPopover && (
        <div
          ref={popoverRef}
          className={cn(
            'absolute right-0 top-full z-30 mt-1 rounded-[var(--radius)] border border-slate-200 bg-white p-3 shadow-xl',
            isBundel ? 'w-96' : 'w-72',
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-700">
              {isBundel ? `Pickronde voor ${aantal} orders` : 'Wie pickt deze order?'}
            </div>
            <button
              onClick={() => setShowPopover(false)}
              className="text-slate-400 hover:text-slate-700"
            >
              <X size={14} />
            </button>
          </div>

          {isBundel && voorgesteldeBundel && voorgesteldeBundel.bundel_besparing > 0 && (
            <div className="mb-2 flex items-center gap-1.5 rounded-md bg-teal-50 px-2 py-1.5 text-[11px] font-medium text-teal-700">
              <TrendingDown size={12} aria-hidden />
              <span>
                Bundel-zending bespaart {formatCurrency(voorgesteldeBundel.bundel_besparing)} verzendkosten — anders {orders.length}× los.
              </span>
            </div>
          )}

          {isBundel && (
            <div className="mb-3 max-h-48 overflow-y-auto rounded border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Orders in deze bundel
              </div>
              <ul className="divide-y divide-slate-100">
                {pickbareOrders.map((o) => {
                  const isSolo = forceSoloIds.has(o.order_id)
                  return (
                    <li key={o.order_id} className="flex items-start gap-2 px-2 py-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={!isSolo}
                        onChange={() => toggleForceSolo(o.order_id)}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
                        title={
                          isSolo
                            ? 'Aangevinkt = wordt onderdeel van de bundel'
                            : 'Uitvinken = aparte solo-zending i.p.v. in de bundel'
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-800">{o.order_nr}</span>
                          <span className="truncate text-slate-500">{o.klant_naam}</span>
                        </div>
                        {isSolo && (
                          <div className="mt-0.5 text-[10px] font-medium text-amber-700">
                            → aparte zending (niet in bundel)
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          <PickerDropdown value={pickerId} onChange={setPickerId} placeholder="Kies picker…" />

          {isBundel && (
            <p className="mt-2 text-[11px] text-slate-500">
              {aantalInBundel >= 2 && aantalSolo > 0
                ? `${aantalInBundel} samen, ${aantalSolo} solo. ${aantalSolo + 1} zending${aantalSolo + 1 === 1 ? '' : 'en'} totaal.`
                : aantalInBundel >= 2
                  ? `${aantalInBundel} orders worden 1 bundel-zending met 1 gezamenlijke pakbon.`
                  : `Alle ${aantal} orders solo — geen bundel.`}
            </p>
          )}

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
              disabled={!pickerId || mutation.isPending}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-45',
                variant === 'compact'
                  ? 'bg-slate-900 hover:bg-slate-800'
                  : 'bg-terracotta-500 hover:bg-terracotta-600',
              )}
            >
              {mutation.isPending && <Loader2 size={12} className="animate-spin" />}
              {isBundel ? 'Start bundel' : 'Start pickronde'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function readErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>
    const parts = [obj.message, obj.details, obj.hint, obj.code]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    if (parts.length > 0) return parts.join(' ')
  }
  return String(err)
}
