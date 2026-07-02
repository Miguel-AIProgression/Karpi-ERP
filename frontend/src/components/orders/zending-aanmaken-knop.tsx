import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Truck, Loader2, X } from 'lucide-react'
import {
  useStartPickrondes,
  useVervoerdersFull,
  printsetPadVoorZendingen,
} from '@/modules/logistiek'
import { PickerDropdown } from '@/components/orders/picker-dropdown'
import { loadLastPicker, saveLastPicker } from '@/lib/orders/last-picker'

interface ZendingAanmakenKnopProps {
  order: {
    id: number
    status: string
    debiteur_nr: number
    afhalen?: boolean
  }
}

/**
 * Knop op order-detail die een zending aanmaakt voor een order met status
 * "Klaar voor verzending".
 *
 * - Verschijnt alleen bij die status.
 * - Disabled als er niet precies 1 actieve vervoerder is.
 * - Roept RPC `start_pickronden` aan (via `useStartPickrondes`), die een rij
 *   in `zendingen` aanmaakt + via trigger een adapter-rij voor de automatisch
 *   gekozen vervoerder.
 */
export function ZendingAanmakenKnop({ order }: ZendingAanmakenKnopProps) {
  const navigate = useNavigate()
  const { data: vervoerders = [], isLoading: vervoerdersLoading } = useVervoerdersFull()
  const createMutation = useStartPickrondes()
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'error'; msg: string } | null>(null)
  const [showPickerPopover, setShowPickerPopover] = useState(false)
  const [pickerId, setPickerId] = useState<number | null>(loadLastPicker())
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showPickerPopover) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPickerPopover(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPickerPopover])

  if (order.status !== 'Klaar voor verzending') return null

  const actieveVervoerders = vervoerders.filter((v) => v.actief)
  const kanAutomatischKiezen = actieveVervoerders.length === 1
  // Afhalen-orders hebben geen vervoerder nodig (mig 205): RPC skipt dispatch.
  const disabled = order.afhalen
    ? busy || createMutation.isPending
    : busy || vervoerdersLoading || createMutation.isPending || !kanAutomatischKiezen

  function openPickerPopover() {
    setFeedback(null)
    setShowPickerPopover(true)
  }

  async function handleStart() {
    if (!pickerId) {
      setFeedback({ type: 'error', msg: 'Kies eerst een picker' })
      return
    }
    setBusy(true)
    setFeedback(null)
    saveLastPicker(pickerId)
    try {
      const zendingen = await createMutation.mutateAsync({ orderIds: [order.id], pickerId })
      setShowPickerPopover(false)
      navigate(printsetPadVoorZendingen(zendingen))
    } catch (err) {
      setFeedback({
        type: 'error',
        msg: readErrorMessage(err),
      })
    } finally {
      setBusy(false)
    }
  }

  const tooltip = order.afhalen
    ? 'Maak afhaal-zending + pakbon (geen vervoerder, geen verzendstickers)'
    : vervoerdersLoading
      ? 'Vervoerders laden...'
      : actieveVervoerders.length === 0
        ? 'Activeer eerst een vervoerder bij Logistiek > instellingen'
        : actieveVervoerders.length > 1
          ? 'Meerdere vervoerders actief: richt eerst prijs/criteria-selectie in'
          : `Maak zending aan via ${actieveVervoerders[0].display_naam} en open de verzendset`

  return (
    <div className="relative inline-flex flex-col items-end gap-1">
      <button
        onClick={openPickerPopover}
        disabled={disabled}
        title={tooltip}
        className="px-4 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
      >
        {busy || createMutation.isPending ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Truck size={14} />
        )}
        {order.afhalen ? 'Afhaal-zending aanmaken' : 'Zending aanmaken'}
      </button>
      {feedback && <div className="text-xs text-rose-600">{feedback.msg}</div>}

      {showPickerPopover && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full z-30 mt-1 w-72 rounded-[var(--radius)] border border-slate-200 bg-white p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-700">Wie pickt deze order?</div>
            <button
              onClick={() => setShowPickerPopover(false)}
              className="text-slate-400 hover:text-slate-700"
            >
              <X size={14} />
            </button>
          </div>
          <PickerDropdown value={pickerId} onChange={setPickerId} placeholder="Kies picker…" />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              onClick={() => setShowPickerPopover(false)}
              className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900"
            >
              Annuleren
            </button>
            <button
              onClick={handleStart}
              disabled={!pickerId || busy || createMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-terracotta-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-terracotta-600 disabled:opacity-45"
            >
              {(busy || createMutation.isPending) && <Loader2 size={12} className="animate-spin" />}
              Start pickronde
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
