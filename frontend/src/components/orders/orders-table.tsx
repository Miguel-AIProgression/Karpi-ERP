import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUp, ArrowDown, ArrowUpDown, AlertCircle, Package, ChevronRight, ChevronDown } from 'lucide-react'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency, formatDate } from '@/lib/utils/formatters'
import { verzendWeekVoor } from '@/lib/orders/verzendweek'
import type { OrderRow, OrderSortField, SortDirection } from '@/lib/supabase/queries/orders'
import type { FactuurVoorOrder } from '@/modules/facturatie'
import { useBundelGroupedOrders, type OrdersListItem } from './use-bundel-grouped-orders'

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

function VerzendweekCel({ order }: { order: OrderRow }) {
  if (order.lever_type === 'datum' && order.afleverdatum) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-terracotta-50 text-terracotta-700 text-xs font-medium"
        title={`Specifieke leverdag: ${formatDate(order.afleverdatum)}`}
      >
        <span aria-hidden>📅</span>
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

function OrderRowCells({ order, indent = false, facturenPerOrder }: {
  order: OrderRow
  indent?: boolean
  facturenPerOrder?: Map<number, FactuurVoorOrder[]>
}) {
  return (
    <>
      <td className={`px-4 py-3 ${indent ? 'pl-10 border-l-2 border-terracotta-200' : ''}`}>
        <div className="flex items-center gap-2">
          <Link
            to={`/orders/${order.id}`}
            className="text-terracotta-500 hover:underline font-medium"
          >
            {order.order_nr}
          </Link>
          {order.heeft_unmatched_regels && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-medium"
              title="Deze order bevat regels zonder gekoppeld artikelnummer — review nodig"
            >
              <AlertCircle size={12} />
              Actie vereist
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
        <StatusBadge status={order.status} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <FactuurCel orderId={order.id} facturenPerOrder={facturenPerOrder} />
      </td>
    </>
  )
}

function BundelHeaderRow({ item, isExpanded, onToggle, facturenPerOrder }: {
  item: Extract<OrdersListItem, { kind: 'bundel' }>
  isExpanded: boolean
  onToggle: () => void
  facturenPerOrder?: Map<number, FactuurVoorOrder[]>
}) {
  const totaalBedrag = item.orders.reduce((sum, o) => sum + (Number(o.totaal_bedrag) || 0), 0)
  const totaalRegels = item.orders.reduce((sum, o) => sum + (o.aantal_regels || 0), 0)
  // Eerste order met factuur — alle orders in een bundel delen typisch
  // dezelfde factuur (ADR-0010 §"Factuur volgt bundel-zending").
  const eersteMetFactuur = item.orders.find((o) =>
    (facturenPerOrder?.get(o.id)?.length ?? 0) > 0
  )
  const debiteurNaam = item.orders[0]?.klant_naam ?? '—'
  const debiteurNr = item.orders[0]?.debiteur_nr

  return (
    <tr
      onClick={onToggle}
      className="border-b border-slate-100 bg-terracotta-50/60 hover:bg-terracotta-50 cursor-pointer transition-colors"
    >
      <td className="px-4 py-2.5" colSpan={4}>
        <div className="flex items-center gap-2 text-sm">
          {isExpanded
            ? <ChevronDown size={16} className="text-terracotta-600" />
            : <ChevronRight size={16} className="text-terracotta-600" />
          }
          <Package size={14} className="text-terracotta-600" />
          <span className="font-medium text-terracotta-800">Bundel {item.zending_nr}</span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-600">{item.orders.length} orders</span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-600">{debiteurNaam}</span>
          {debiteurNr && (
            <span className="text-xs text-slate-400">#{debiteurNr}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 text-slate-500 text-xs">
        Gezamenlijke zending
      </td>
      <td className="px-4 py-2.5 text-right text-slate-600 text-sm">
        {totaalRegels}
      </td>
      <td className="px-4 py-2.5 text-right font-medium text-sm">
        {formatCurrency(totaalBedrag)}
      </td>
      <td className="px-4 py-2.5">
        {/* Status van de bundel: pak de status van de eerste order; bundels
            zijn in praktijk altijd synchroon (start_pickronden + voltooi_pickronde
            transitioneren ze samen). */}
        <StatusBadge status={item.orders[0].status} />
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        {eersteMetFactuur && (
          <FactuurCel
            orderId={eersteMetFactuur.id}
            facturenPerOrder={facturenPerOrder}
          />
        )}
      </td>
    </tr>
  )
}

export function OrdersTable({ orders, isLoading, sortBy, sortDir, onSort, facturenPerOrder }: OrdersTableProps) {
  const grouped = useBundelGroupedOrders(orders)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (zendingNr: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(zendingNr)) next.delete(zendingNr)
      else next.add(zendingNr)
      return next
    })
  }

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
          {grouped.map((item) => {
            if (item.kind === 'solo') {
              return (
                <tr
                  key={`order-${item.order.id}`}
                  className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                >
                  <OrderRowCells order={item.order} facturenPerOrder={facturenPerOrder} />
                </tr>
              )
            }

            const isOpen = expanded.has(item.zending_nr)
            return (
              <Fragment key={`bundel-${item.zending_nr}`}>
                <BundelHeaderRow
                  item={item}
                  isExpanded={isOpen}
                  onToggle={() => toggle(item.zending_nr)}
                  facturenPerOrder={facturenPerOrder}
                />
                {isOpen && item.orders.map((order) => (
                  <tr
                    key={`order-${order.id}`}
                    className="border-b border-slate-50 hover:bg-slate-50 bg-terracotta-50/20 transition-colors"
                  >
                    <OrderRowCells order={order} indent facturenPerOrder={facturenPerOrder} />
                  </tr>
                ))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
