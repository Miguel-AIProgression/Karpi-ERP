import { Link } from 'react-router-dom'
import { ArrowUp, ArrowDown, ArrowUpDown, AlertCircle, AlertTriangle, CheckCircle, Mail } from 'lucide-react'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency, formatDate } from '@/lib/utils/formatters'
import { verzendWeekVoor } from '@/lib/orders/verzendweek'
import { cn } from '@/lib/utils/cn'
import type { OrderRow, OrderSortField, SortDirection } from '@/lib/supabase/queries/orders'
import type { FactuurVoorOrder } from '@/modules/facturatie'
import { useBundelGroupedOrders } from './use-bundel-grouped-orders'

interface OrdersTableProps {
  orders: OrderRow[]
  isLoading: boolean
  sortBy: OrderSortField
  sortDir: SortDirection
  onSort: (field: OrderSortField) => void
  facturenPerOrder?: Map<number, FactuurVoorOrder[]>
}

function SortIcon({ field, sortBy, sortDir }: { field: OrderSortField; sortBy: OrderSortField; sortDir: SortDirection }) {
  if (field !== sortBy) return <ArrowUpDown size={14} className="text-slate-300" />
  return sortDir === 'asc'
    ? <ArrowUp size={14} className="text-terracotta-500" />
    : <ArrowDown size={14} className="text-terracotta-500" />
}

function SortHeader({ field, label, align = 'left', sortBy, sortDir, onSort }: {
  field: OrderSortField
  label: string
  align?: 'left' | 'right'
  sortBy: OrderSortField
  sortDir: SortDirection
  onSort: (field: OrderSortField) => void
}) {
  return (
    <th
      className={`text-${align} px-4 py-3 font-medium text-slate-600 cursor-pointer select-none hover:text-slate-900 transition-colors`}
      onClick={() => onSort(field)}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        <SortIcon field={field} sortBy={sortBy} sortDir={sortDir} />
      </span>
    </th>
  )
}

// Prioriteit-volgorde voor factuur-status bij meerdere facturen per order:
// actie-eisende statussen winnen zodat ze niet verstopt raken achter Betaald.
const FACTUUR_PRIORITEIT: Record<string, number> = {
  Aanmaning: 1,
  Herinnering: 2,
  Verstuurd: 3,
  Concept: 4,
  Betaald: 5,
  Gecrediteerd: 6,
}

function kiesPrimaireFactuur(lijst: FactuurVoorOrder[]): FactuurVoorOrder {
  return [...lijst].sort(
    (a, b) => (FACTUUR_PRIORITEIT[a.status] ?? 99) - (FACTUUR_PRIORITEIT[b.status] ?? 99)
  )[0]
}

function FactuurCel({ orderId, facturenPerOrder }: {
  orderId: number
  facturenPerOrder?: Map<number, FactuurVoorOrder[]>
}) {
  const lijst = facturenPerOrder?.get(orderId) ?? []
  if (lijst.length === 0) {
    return <span className="text-slate-300">—</span>
  }
  const primair = kiesPrimaireFactuur(lijst)
  return (
    <Link
      to={`/facturatie/${primair.id}`}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1.5 font-mono text-xs text-terracotta-500 hover:underline"
      title={`${primair.status} · ${formatDate(primair.factuurdatum)}`}
    >
      <span>{primair.factuur_nr}</span>
      <StatusBadge
        status={primair.status}
        type="factuur"
        className="!px-1.5 !py-0 text-[10px] font-normal"
      />
      {lijst.length > 1 && (
        <span className="text-slate-400">+{lijst.length - 1}</span>
      )}
    </Link>
  )
}

function BronBadge({ bron }: { bron?: string | null }) {
  if (!bron || bron === 'handmatig') return null
  const config: Record<string, { label: string; className: string }> = {
    shopify:     { label: 'Shopify',     className: 'bg-green-100 text-green-700' },
    edi:         { label: 'EDI',         className: 'bg-blue-100 text-blue-700' },
    lightspeed:  { label: 'Lightspeed',  className: 'bg-amber-100 text-amber-700' },
    email:       { label: 'E-mail',      className: 'bg-purple-100 text-purple-700' },
    oud_systeem: { label: 'Oud systeem', className: 'bg-slate-100 text-slate-500' },
  }
  const c = config[bron] ?? { label: bron, className: 'bg-slate-100 text-slate-600' }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${c.className}`}>
      {c.label}
    </span>
  )
}

function VerzendweekCel({ order }: { order: OrderRow }) {
  if (order.lever_type === 'datum' && order.afleverdatum) {
    return (
      <span
        className="font-semibold text-terracotta-700"
        title={`Specifieke leverdag: ${formatDate(order.afleverdatum)}`}
      >
        {formatDate(order.afleverdatum)}
      </span>
    )
  }
  const w = verzendWeekVoor(order.afleverdatum)
  return w ? (
    <span className="text-slate-900 font-medium" title={order.afleverdatum ? formatDate(order.afleverdatum) : undefined}>
      Wk {w.week} · {w.jaar}
    </span>
  ) : (
    <span className="text-slate-300">—</span>
  )
}

const FINALE_STATUSSEN = new Set(['Verzonden', 'Geannuleerd'])

function BevestigingBadge({ bevestigd_at, status }: { bevestigd_at?: string | null; status: string }) {
  if (bevestigd_at) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-50 text-green-700 text-[10px] font-medium"
        title={`Orderbevestiging verzonden op ${formatDate(bevestigd_at)}`}
      >
        <CheckCircle size={10} />
        OB {formatDate(bevestigd_at)}
      </span>
    )
  }
  if (FINALE_STATUSSEN.has(status)) return null
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-50 text-slate-400 text-[10px] font-medium"
      title="Nog geen orderbevestiging verstuurd"
    >
      <Mail size={10} />
      Geen OB
    </span>
  )
}

interface BundelContext {
  zendingNr: string
  positie: 'enkele' | 'eerste' | 'midden' | 'laatste'
  anderOrderNrs: string[]
}

function OrderTr({ order, bundel, facturenPerOrder }: {
  order: OrderRow
  bundel: BundelContext | null
  facturenPerOrder?: Map<number, FactuurVoorOrder[]>
}) {
  // Bundel-styling: dunne linker-border in terracotta voor alle bundel-orders.
  // Eerste/laatste krijgen iets meer ademruimte; midden-orders sluiten aan.
  const rowClass = cn(
    'border-b border-slate-50 hover:bg-slate-50 transition-colors',
    bundel && 'bg-terracotta-50/30 hover:bg-terracotta-50/50',
  )

  // Eerste cel krijgt linker-accent zodra de order in een bundel zit.
  const firstCellClass = cn(
    'px-4 py-3',
    bundel && 'border-l-[3px] border-terracotta-300',
  )

  const toonBundelChip = bundel && (bundel.positie === 'eerste' || bundel.positie === 'enkele')

  return (
    <tr className={rowClass}>
      <td className={firstCellClass}>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to={`/orders/${order.id}`}
            className="text-terracotta-500 hover:underline font-medium"
          >
            {order.order_nr}
          </Link>
          <BronBadge bron={order.bron_systeem} />
          {toonBundelChip && bundel && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-terracotta-100 text-terracotta-700 text-[11px] font-medium"
              title={`Gebundeld verzonden in ${bundel.zendingNr}${bundel.anderOrderNrs.length > 0 ? ` · samen met ${bundel.anderOrderNrs.join(', ')}` : ''}`}
            >
              {bundel.zendingNr}
            </span>
          )}
          {order.heeft_unmatched_regels && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-medium"
              title="Deze order bevat regels zonder gekoppeld artikelnummer — review nodig"
            >
              <AlertCircle size={12} />
              Actie vereist
            </span>
          )}
          {order.heeft_deadline_conflict_na_swap && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-xs font-medium"
              title={`Voorraad is eerder afgestaan aan een urgentere order, en de inkoop waarop deze order daarna gerekend werd is vertraagd — afleverdatum loopt nu uit. Operator-actie: klant bellen / spoedinkoop / voorraad uit ander kanaal.${
                order.deadline_conflict_na_swap_at
                  ? ` Laatste signaal: ${formatDate(order.deadline_conflict_na_swap_at)}`
                  : ''
              }`}
            >
              <AlertTriangle size={12} />
              Deadline-conflict
            </span>
          )}
        </div>
        {order.oud_order_nr && (
          <span className="block text-xs text-slate-400">
            Oud: {order.oud_order_nr}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
        {formatDate(order.orderdatum)}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <VerzendweekCel order={order} />
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/klanten/${order.debiteur_nr}`}
          className="hover:text-terracotta-500"
        >
          {order.klant_naam}
        </Link>
        <span className="block text-xs text-slate-400">
          #{order.debiteur_nr}
        </span>
      </td>
      <td className="px-4 py-3 text-slate-600 max-w-48 truncate" title={order.klant_referentie ?? ''}>
        {order.klant_referentie ?? '—'}
      </td>
      <td className="px-4 py-3 text-right text-slate-600">
        {order.aantal_regels}
      </td>
      <td className="px-4 py-3 text-right font-medium">
        {formatCurrency(order.totaal_bedrag)}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <StatusBadge status={order.status} />
          <BevestigingBadge bevestigd_at={order.bevestigd_at} status={order.status} />
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <FactuurCel orderId={order.id} facturenPerOrder={facturenPerOrder} />
      </td>
    </tr>
  )
}

export function OrdersTable({ orders, isLoading, sortBy, sortDir, onSort, facturenPerOrder }: OrdersTableProps) {
  const grouped = useBundelGroupedOrders(orders)

  if (isLoading) {
    return (
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
        Orders laden...
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
        Geen orders gevonden
      </div>
    )
  }

  const sortProps = { sortBy, sortDir, onSort }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50">
            <SortHeader field="order_nr" label="Order" {...sortProps} />
            <SortHeader field="orderdatum" label="Orderdatum" {...sortProps} />
            <SortHeader field="afleverdatum" label="Verzendweek" {...sortProps} />
            <SortHeader field="klant_naam" label="Klant" {...sortProps} />
            <th className="text-left px-4 py-3 font-medium text-slate-600">Referentie</th>
            <SortHeader field="aantal_regels" label="Regels" align="right" {...sortProps} />
            <SortHeader field="totaal_bedrag" label="Bedrag" align="right" {...sortProps} />
            <SortHeader field="status" label="Status" {...sortProps} />
            <th className="text-left px-4 py-3 font-medium text-slate-600">Factuur</th>
          </tr>
        </thead>
        <tbody>
          {grouped.flatMap((item) => {
            if (item.kind === 'solo') {
              return [
                <OrderTr
                  key={`order-${item.order.id}`}
                  order={item.order}
                  bundel={null}
                  facturenPerOrder={facturenPerOrder}
                />,
              ]
            }
            return item.orders.map((order, idx) => {
              const positie =
                item.orders.length === 1
                  ? 'enkele'
                  : idx === 0
                    ? 'eerste'
                    : idx === item.orders.length - 1
                      ? 'laatste'
                      : 'midden'
              const anderOrderNrs = item.orders
                .filter((o) => o.id !== order.id)
                .map((o) => o.order_nr)
              return (
                <OrderTr
                  key={`order-${order.id}`}
                  order={order}
                  bundel={{ zendingNr: item.zending_nr, positie, anderOrderNrs }}
                  facturenPerOrder={facturenPerOrder}
                />
              )
            })
          })}
        </tbody>
      </table>
    </div>
  )
}
