import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Printer, PackageCheck } from 'lucide-react'
import { useCreateZendingVoorOrder } from '../hooks/use-zendingen'
import { useVervoerders } from '../hooks/use-vervoerders'
import type { PickShipOrder } from '@/modules/magazijn'

interface VerzendsetButtonProps {
  order: PickShipOrder
}

export function VerzendsetButton({ order }: VerzendsetButtonProps) {
  const navigate = useNavigate()
  const createMutation = useCreateZendingVoorOrder()
  const { data: vervoerders = [] } = useVervoerders()
  const [error, setError] = useState<string | null>(null)

  // Sinds mig 210 wordt de vervoerder server-side gekozen via verzendregels
  // (selecteer_vervoerder_voor_zending). Pre-creëer-time hoeven we alleen te
  // controleren of er ÜberHaupt een actieve vervoerder is — anders heeft de
  // selector niets om uit te kiezen.
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
        : 'Start pickronde — print stickers en pakbon, dan afronden op printset-pagina'

  async function handleClick() {
    setError(null)
    try {
      const zending = await createMutation.mutateAsync(order.order_id)
      navigate(`/logistiek/${zending.zending_nr}/printset`)
    } catch (err) {
      setError(readErrorMessage(err))
    }
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
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
