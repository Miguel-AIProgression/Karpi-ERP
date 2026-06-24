import { Link } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import { formatDateTime } from '@/lib/utils/formatters'
import { formatCurrency } from '@/lib/utils/formatters'
import { useOrderEvents, type OrderEvent } from '@/modules/orders-lifecycle'

// ── Configuratie: leesbare labels per event-type ─────────────────────────────
// Nieuwe DB-event-types zonder entry hier worden automatisch omgezet vanuit
// snake_case → leesbare tekst (zie formatEventType hieronder).
const EVENT_LABELS: Record<string, string> = {
  aangemaakt:                    'Order aangemaakt',
  pickronde_gestart:             'Pickronde gestart',
  pickronde_voltooid:            'Pickronde voltooid — verzonden',
  pickronde_teruggedraaid:       'Pickronde geannuleerd',
  deels_verzonden:               'Deels verzonden',
  geannuleerd:                   'Order geannuleerd',
  wacht_status_herberekend:      'Status herberekend',
  backfill_fase_normalisatie:    'Status genormaliseerd (backfill)',
  prijs_geaccepteerd:            'Prijs geaccepteerd (€0 bewust)',
  deelzending_gestart:           'Deelzending aangemaakt',
  maatwerk_afgerond:             'Maatwerk afgerond',
  levertijd_gewijzigd_door_eta:  'Levertijd gewijzigd door ETA-update',
  claim_geswapt_weg:             'Voorraad-claim afgestaan aan andere order',
  claim_geswapt_naar:            'Voorraad ontvangen via claim-swap',
  deadline_conflict_na_swap:     'Deadline-conflict gedetecteerd na swap',
  // mig 503
  orderbevestiging_verstuurd:    'Orderbevestiging verstuurd',
  creditfactuur_aangemaakt:      'Creditfactuur aangemaakt',
  order_gewijzigd:               'Order gewijzigd',
}

/** Fallback voor onbekende event-types: snake_case → "Leesbare Tekst". */
function formatEventType(type: string): string {
  return (
    EVENT_LABELS[type] ??
    type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

// ── Kleur-dot per event-categorie ────────────────────────────────────────────
function dotKleur(type: string): string {
  if (type === 'geannuleerd')                              return 'bg-red-400'
  if (type === 'orderbevestiging_verstuurd')               return 'bg-emerald-400'
  if (type === 'creditfactuur_aangemaakt')                 return 'bg-amber-400'
  if (type === 'order_gewijzigd')                          return 'bg-blue-300'
  if (type === 'pickronde_voltooid' || type === 'deels_verzonden') return 'bg-emerald-400'
  if (type === 'aangemaakt')                               return 'bg-slate-400'
  if (type.startsWith('claim_') || type === 'deadline_conflict_na_swap') return 'bg-amber-400'
  return 'bg-slate-300'
}

// ── Extra detail-tekst per event-type ────────────────────────────────────────
function eventDetail(event: OrderEvent): React.ReactNode | null {
  const meta = event.metadata as Record<string, unknown> | null

  if (event.event_type === 'orderbevestiging_verstuurd') {
    const m = meta as { email_naar?: string } | null
    if (m?.email_naar) return <span>naar {m.email_naar}</span>
  }

  if (event.event_type === 'creditfactuur_aangemaakt') {
    const m = meta as { creditfactuur_nr?: string; originele_factuur_nr?: string; reden?: string | null } | null
    if (m?.creditfactuur_nr) {
      return (
        <span>
          {m.creditfactuur_nr}
          {m.originele_factuur_nr ? ` (voor ${m.originele_factuur_nr})` : ''}
          {m.reden ? ` — ${m.reden}` : ''}
        </span>
      )
    }
  }

  if (event.event_type === 'order_gewijzigd') {
    const m = meta as { oud_bedrag?: number | null; nieuw_bedrag?: number | null } | null
    if (m?.oud_bedrag != null && m?.nieuw_bedrag != null && m.oud_bedrag !== m.nieuw_bedrag) {
      return (
        <span>
          {formatCurrency(m.oud_bedrag)} → {formatCurrency(m.nieuw_bedrag)}
        </span>
      )
    }
  }

  if (event.event_type === 'claim_geswapt_weg') {
    const m = meta as { naar_order_id?: number; aantal?: number; fysiek_artikelnr?: string | null } | null
    if (m?.naar_order_id != null) {
      return (
        <span>
          {m.aantal != null ? `${m.aantal} stuks` : ''}
          {m.fysiek_artikelnr ? ` ${m.fysiek_artikelnr}` : ''} → order{' '}
          <Link to={`/orders/${m.naar_order_id}`} className="text-terracotta-500 hover:underline font-mono">
            #{m.naar_order_id}
          </Link>
        </span>
      )
    }
  }

  if (event.event_type === 'claim_geswapt_naar') {
    const m = meta as { van_order_id?: number } | null
    if (m?.van_order_id != null) {
      return (
        <span>
          van order{' '}
          <Link to={`/orders/${m.van_order_id}`} className="text-terracotta-500 hover:underline font-mono">
            #{m.van_order_id}
          </Link>
        </span>
      )
    }
  }

  if (event.event_type === 'levertijd_gewijzigd_door_eta') {
    const m = meta as { oude_week?: string; nieuwe_week?: string } | null
    if (m?.oude_week && m?.nieuwe_week) {
      return <span>{m.oude_week} → {m.nieuwe_week}</span>
    }
  }

  if (event.reden) {
    return <span>{event.reden}</span>
  }

  return null
}

// ── Actor-badge ───────────────────────────────────────────────────────────────
function actorLabel(event: OrderEvent): string | null {
  const meta = event.metadata as Record<string, unknown> | null
  const gedaanDoor = meta?.gedaan_door
  if (typeof gedaanDoor === 'string' && gedaanDoor.length > 0 && gedaanDoor !== 'onbekend') {
    return gedaanDoor
  }
  return null
}

// ── Eén event-rij ─────────────────────────────────────────────────────────────
function EventRij({ event }: { event: OrderEvent }) {
  const label  = formatEventType(event.event_type)
  const detail = eventDetail(event)
  const actor  = actorLabel(event)

  return (
    <li className="py-2.5 flex items-start gap-3">
      <div className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${dotKleur(event.event_type)}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm text-slate-700 font-medium leading-snug">{label}</span>
          {detail && (
            <span className="text-xs text-slate-500">{detail}</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
          <span>{formatDateTime(event.created_at)}</span>
          {actor && <span>· {actor}</span>}
        </div>
      </div>
    </li>
  )
}

// ── Publieke component ────────────────────────────────────────────────────────
interface Props {
  orderId: number
}

export function OrderLogboek({ orderId }: Props) {
  const { data: events, isLoading } = useOrderEvents(orderId)

  if (isLoading || !events || events.length === 0) return null

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <ClipboardList size={14} className="text-slate-400" />
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Logboek
        </h2>
      </div>
      <ul className="divide-y divide-slate-100">
        {events.map((ev) => (
          <EventRij key={ev.id} event={ev} />
        ))}
      </ul>
    </div>
  )
}
