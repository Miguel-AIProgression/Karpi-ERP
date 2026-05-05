import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Truck, Loader2 } from 'lucide-react'
import { useCreateZendingVoorOrder, useVervoerdersFull } from '@/modules/logistiek'

interface ZendingAanmakenKnopProps {
  order: {
    id: number
    status: string
    debiteur_nr: number
  }
}

/**
 * Knop op order-detail die een zending aanmaakt voor een order met status
 * "Klaar voor verzending".
 *
 * - Verschijnt alleen bij die status.
 * - Disabled als er niet precies 1 actieve vervoerder is.
 * - Roept RPC `create_zending_voor_order` aan, die een rij in `zendingen`
 *   aanmaakt + via trigger een adapter-rij voor de automatisch gekozen vervoerder.
 */
export function ZendingAanmakenKnop({ order }: ZendingAanmakenKnopProps) {
  const navigate = useNavigate()
  const { data: vervoerders = [], isLoading: vervoerdersLoading } = useVervoerdersFull()
  const createMutation = useCreateZendingVoorOrder()
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'error'; msg: string } | null>(null)

  if (order.status !== 'Klaar voor verzending') return null

  const actieveVervoerders = vervoerders.filter((v) => v.actief)
  const kanAutomatischKiezen = actieveVervoerders.length === 1
  const disabled = busy || vervoerdersLoading || createMutation.isPending || !kanAutomatischKiezen

  async function handleClick() {
    setBusy(true)
    setFeedback(null)
    try {
      const zending = await createMutation.mutateAsync(order.id)
      navigate(`/logistiek/${zending.zending_nr}/printset`)
    } catch (err) {
      setFeedback({
        type: 'error',
        msg: readErrorMessage(err),
      })
    } finally {
      setBusy(false)
    }
  }

  const tooltip = vervoerdersLoading
    ? 'Vervoerders laden...'
    : actieveVervoerders.length === 0
      ? 'Activeer eerst een vervoerder bij Logistiek > instellingen'
      : actieveVervoerders.length > 1
        ? 'Meerdere vervoerders actief: richt eerst prijs/criteria-selectie in'
        : `Maak zending aan via ${actieveVervoerders[0].display_naam} en open de verzendset`

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={disabled}
        title={tooltip}
        className="px-4 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
      >
        {busy || createMutation.isPending ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Truck size={14} />
        )}
        Zending aanmaken
      </button>
      {feedback && <div className="text-xs text-rose-600">{feedback.msg}</div>}
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
