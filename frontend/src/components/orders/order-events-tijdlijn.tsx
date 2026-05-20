import { Link } from 'react-router-dom'
import { ArrowLeftRight, AlertTriangle } from 'lucide-react'
import { formatDate } from '@/lib/utils/formatters'
import { useOrderEvents, type OrderEvent } from '@/modules/orders-lifecycle'

interface Props {
  orderId: number
}

/**
 * Toont swap- en deadline-conflict-events voor een order (ADR-0027 Ingreep 4/5).
 * Filtert uit `order_events` op `event_type IN ('claim_geswapt_weg',
 * 'claim_geswapt_naar', 'deadline_conflict_na_swap')` — overige events
 * (aangemaakt, pickronde_*, geannuleerd) zijn elders zichtbaar via
 * `orders.status` + audit-trail en horen niet in deze tijdlijn.
 *
 * Order-nummers worden niet meegegeven in de event-metadata (alleen `*_order_id`),
 * dus we tonen een korte `#ID`-link — de bestemmings-page laadt de echte naam.
 */
export function OrderEventsTijdlijn({ orderId }: Props) {
  const { data: events, isLoading } = useOrderEvents(orderId)

  if (isLoading || !events) return null

  const swapEvents = events.filter(isSwapOrConflict)
  if (swapEvents.length === 0) return null

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <ArrowLeftRight size={15} className="text-slate-400" />
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Claim-historie
        </h2>
      </div>

      <ul className="divide-y divide-slate-100">
        {swapEvents.map((ev) => (
          <li key={ev.id} className="py-2">
            <SwapEventRij event={ev} />
          </li>
        ))}
      </ul>
    </div>
  )
}

type SwapEvent = OrderEvent & {
  event_type: 'claim_geswapt_weg' | 'claim_geswapt_naar' | 'deadline_conflict_na_swap'
}

function isSwapOrConflict(ev: OrderEvent): ev is SwapEvent {
  return (
    ev.event_type === 'claim_geswapt_weg' ||
    ev.event_type === 'claim_geswapt_naar' ||
    ev.event_type === 'deadline_conflict_na_swap'
  )
}

function SwapEventRij({ event }: { event: SwapEvent }) {
  const datum = formatDate(event.created_at)

  if (event.event_type === 'claim_geswapt_weg') {
    const meta = event.metadata
    const tegenId = meta?.naar_order_id
    const aantal = meta?.aantal
    const artikel = meta?.fysiek_artikelnr
    if (tegenId == null || aantal == null) {
      return <RawEventFallback event={event} />
    }
    return (
      <div className="flex items-start gap-2 text-sm">
        <ArrowLeftRight size={14} className="text-amber-500 mt-0.5 shrink-0" />
        <div>
          <span className="text-slate-700">
            Voorraad-claim ({aantal} stuks{artikel ? ` ${artikel}` : ''}) afgestaan aan order{' '}
            <Link
              to={`/orders/${tegenId}`}
              className="text-terracotta-500 hover:underline font-mono"
            >
              #{tegenId}
            </Link>
          </span>{' '}
          <span className="text-xs text-slate-400">· {datum}</span>
        </div>
      </div>
    )
  }

  if (event.event_type === 'claim_geswapt_naar') {
    const meta = event.metadata
    const tegenId = meta?.van_order_id
    if (tegenId == null) {
      return <RawEventFallback event={event} />
    }
    return (
      <div className="flex items-start gap-2 text-sm">
        <ArrowLeftRight size={14} className="text-emerald-500 mt-0.5 shrink-0" />
        <div>
          <span className="text-slate-700">
            Voorraad ontvangen via swap van order{' '}
            <Link
              to={`/orders/${tegenId}`}
              className="text-terracotta-500 hover:underline font-mono"
            >
              #{tegenId}
            </Link>
          </span>{' '}
          <span className="text-xs text-slate-400">· {datum}</span>
        </div>
      </div>
    )
  }

  // event.event_type === 'deadline_conflict_na_swap'
  return (
    <div className="flex items-start gap-2 text-sm">
      <AlertTriangle size={14} className="text-red-500 mt-0.5 shrink-0" />
      <div>
        <span className="font-medium text-red-700">Deadline-conflict:</span>{' '}
        <span className="text-slate-700">
          IO vertraagd, afleverdatum &gt; standaard. Operator-actie vereist.
        </span>{' '}
        <span className="text-xs text-slate-400">· {datum}</span>
      </div>
    </div>
  )
}

/** Graceful fallback bij missing payload-velden — toont kale event-type i.p.v. crashen. */
function RawEventFallback({ event }: { event: SwapEvent }) {
  return (
    <div className="text-sm text-slate-500 italic">
      {event.event_type} · {formatDate(event.created_at)}
    </div>
  )
}
