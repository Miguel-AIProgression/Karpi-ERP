import { Link2 } from 'lucide-react'
import type { OrderRow } from '@/lib/supabase/queries/orders'
import { formatCurrency } from '@/lib/utils/formatters'

/** Mig 569 (ADR-0039/0040): Combi-levering-groep — orders die samen wachten
 *  op (of net) de vrachtvrije-drempel (hebben) gehaald, om verzendkosten te
 *  besparen. Eén bron voor orders-overview (orders-table.tsx) én order-detail
 *  (order-header.tsx) — los van en anders gestyled dan de fysieke
 *  zending-bundel-chip (mig 222, andere reden: al daadwerkelijk verzonden). */
export function CombiLeveringBadge({ order }: { order: Pick<OrderRow, 'combi_levering_aantal_orders' | 'combi_levering_andere_orders' | 'wacht_op_combi_levering'> }) {
  const aantal = order.combi_levering_aantal_orders
  if (!aantal || aantal < 2) return null
  const andere = order.combi_levering_andere_orders ?? []
  const anderNrs = andere.map((o) => o.order_nr).join(', ')
  const wacht = order.wacht_op_combi_levering
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-indigo-100 text-indigo-700 px-2 py-0.5 text-xs font-semibold"
      title={
        wacht
          ? `Wacht samen met ${anderNrs || 'andere orders'} op de vrachtvrije-drempel`
          : `Wordt samen met ${anderNrs || 'andere orders'} verzonden (vrachtvrije-drempel gehaald)`
      }
    >
      <Link2 size={12} />
      Combi-levering ({aantal})
    </span>
  )
}

/** Mig 575: fallback-drempel — mirrort combi_levering_status z'n eigen
 *  COALESCE(verzend_drempel, 500) (SQL bron-van-waarheid); de view geeft de
 *  rauwe (nullable) verzend_drempel door, de fallback leeft hier. */
const DEFAULT_DREMPEL = 500

/** Pure helper: waaróm wacht deze Combi-levering-groep nog?
 *  Twee onafhankelijke blokkades in combi_levering_status — (a) subtotaal
 *  onder de vrachtvrije-drempel, (b) niet alle groepsleden pickbaar (vaak
 *  een maatwerk-groepsgenoot nog in productie). Beide kunnen tegelijk gelden
 *  — dan wint (a): de drempel is niet gehaald, dus (b) doet er nog niet toe;
 *  dat is de primaire, bruikbare reden voor de gebruiker.
 *  Retourneert null als er niets te melden is. */
export function combiWachtReden(
  subtotaal: number | null | undefined,
  drempel: number | null | undefined,
  alleLedenPickbaar: boolean | null | undefined
): string | null {
  if (subtotaal == null) return null
  const effectieveDrempel = drempel ?? DEFAULT_DREMPEL
  if (subtotaal < effectieveDrempel) {
    const tekort = effectieveDrempel - subtotaal
    return `${formatCurrency(subtotaal)} van ${formatCurrency(effectieveDrempel)} — nog ${formatCurrency(tekort)} nodig`
  }
  if (!alleLedenPickbaar) {
    return `Drempel gehaald (${formatCurrency(subtotaal)}) — wacht tot alle orders van de groep leverbaar zijn`
  }
  return null
}

/** Compacte, gedempte sub-regel onder de badge — alleen zichtbaar zolang de
 *  order daadwerkelijk wacht (wacht_op_combi_levering). Volgt de bestaande
 *  "Combi met: ..."-sub-regel-stijl (kleine gedempte tekst, block-level zodat
 *  hij op een eigen regel valt). `className` laat de caller de exacte
 *  tekstgrootte matchen (order-header.tsx gebruikt text-sm, orders-table.tsx
 *  text-xs). */
export function CombiWachtRedenLine({
  order,
  className = 'text-xs text-slate-400',
}: {
  order: Pick<
    OrderRow,
    | 'wacht_op_combi_levering'
    | 'combi_levering_groep_subtotaal'
    | 'combi_levering_drempel'
    | 'combi_levering_alle_leden_pickbaar'
  >
  className?: string
}) {
  if (!order.wacht_op_combi_levering) return null
  const reden = combiWachtReden(
    order.combi_levering_groep_subtotaal,
    order.combi_levering_drempel,
    order.combi_levering_alle_leden_pickbaar
  )
  if (!reden) return null
  return <span className={`block ${className}`}>{reden}</span>
}
