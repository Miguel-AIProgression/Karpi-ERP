import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Printer, PackageCheck, X } from 'lucide-react'
import { useCreateZendingVoorOrder } from '../hooks/use-zendingen'
import { useVervoerders } from '../hooks/use-vervoerders'
import { PickerDropdown } from '@/components/orders/picker-dropdown'
import type { PickShipOrder } from '@/modules/magazijn'

interface VerzendsetButtonProps {
  order: PickShipOrder
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

export function VerzendsetButton({ order }: VerzendsetButtonProps) {
  const navigate = useNavigate()
  const createMutation = useCreateZendingVoorOrder()
  const { data: vervoerders = [] } = useVervoerders()
  const [error, setError] = useState<string | null>(null)
  const [showPickerPopover, setShowPickerPopover] = useState(false)
  const [pickerId, setPickerId] = useState<number | null>(loadLastPicker())
  const popoverRef = useRef<HTMLDivElement>(null)

  // Auto-close popover bij click buiten
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

  const heeftActieveVervoerder = vervoerders.some((v) => v.actief)
  const isVolledigPickbaar = order.regels.length > 0 && order.regels.every((r) => r.is_pickbaar)

  const disabled = order.afhalen
    ? createMutation.isPending || !isVolledigPickbaar
    : createMutation.isPending || !heeftActieveVervoerder || !isVolledigPickbaar

  const tooltip = order.afhalen
    ? !isVolledigPickbaar
      ? 'Nog niet alle regels zijn klaar om te picken'
      : 'Start afhaal-pickronde (geen verzendstickers)'
    : !heeftActieveVervoerder
      ? 'Activeer eerst minstens één vervoerder bij Logistiek > Vervoerders'
      : !isVolledigPickbaar
        ? 'Nog niet alle regels zijn klaar om te picken'
        : 'Start pickronde — kies eerst de picker, daarna print stickers en pakbon'

  function openPickerPopover() {
    setError(null)
    setShowPickerPopover(true)
  }

  async function handleStart() {
    if (!pickerId) {
      setError('Kies eerst een picker')
      return
    }
    setError(null)
    saveLastPicker(pickerId)
    try {
      const zendingen = await createMutation.mutateAsync({ orderId: order.order_id, pickerId })
      setShowPickerPopover(false)
      if (zendingen.length === 1) {
        navigate(`/logistiek/${zendingen[0].zending_nr}/printset`)
      } else {
        // Multi-vervoerder: order is gesplitst in N zendingen — open bulk-printset
        // zodat alle stickers/pakbonnen in één flow geprint worden.
        const qs = encodeURIComponent(zendingen.map((z) => z.zending_nr).join(','))
        navigate(`/logistiek/printset/bulk?zendingen=${qs}`)
      }
    } catch (err) {
      setError(readErrorMessage(err))
    }
  }

  return (
    <div className="relative inline-flex flex-col items-end gap-1">
      <button
        onClick={openPickerPopover}
        disabled={disabled}
        title={tooltip}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {createMutation.isPending ? (
          <Loader2 size={13} className="animate-spin" />
        ) : order.afhalen ? (
          <PackageCheck size={13} />
        ) : (
          <Printer size={13} />
        )}
        {order.afhalen ? 'Afhaalset' : 'Verzendset'}
      </button>
      {error && <div className="max-w-64 text-right text-[11px] text-rose-600">{error}</div>}

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
              disabled={!pickerId || createMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-45"
            >
              {createMutation.isPending && <Loader2 size={12} className="animate-spin" />}
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
