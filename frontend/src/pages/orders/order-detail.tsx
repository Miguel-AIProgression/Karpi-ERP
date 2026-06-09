import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronUp, Mail } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { OrderHeader } from '@/components/orders/order-header'
import { OrderAddresses } from '@/components/orders/order-addresses'
import { OrderRegelsTable } from '@/components/orders/order-regels-table'
import { OrderFacturen } from '@/components/orders/order-facturen'
import { OrderEventsTijdlijn } from '@/components/orders/order-events-tijdlijn'
import { ZendingAanmakenKnop } from '@/components/orders/zending-aanmaken-knop'
import { useOrderDetail, useOrderRegels } from '@/hooks/use-orders'
import { useLevertijdVoorOrder, useClaimsVoorOrder } from '@/modules/reserveringen'
import { computeOrderLock } from '@/lib/utils/order-lock'
import { DocumentenCompact } from '@/components/documenten/documenten-compact'
import { EdiLeverweekBevestigen } from '@/components/orders/edi-leverweek-bevestigen'
import { isLeverweekTeBevestigen } from '@/lib/orders/edi-leverweek'
import { DebiteurBevestigenWidget } from '@/components/orders/debiteur-bevestigen-widget'
import { BastaAfhandelingPaneel } from '@/components/orders/basta-afhandeling-paneel'

function EmailInhoudPanel({ body }: { body: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-5 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-[var(--radius)]"
      >
        <Mail size={14} className="text-slate-400" />
        <span className="flex-1">Originele e-mail</span>
        {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
      </button>
      {open && (
        <div className="px-5 pb-4 border-t border-slate-100">
          <pre className="mt-3 text-xs text-slate-600 whitespace-pre-wrap font-mono bg-slate-50 rounded p-3 max-h-96 overflow-y-auto">
            {body}
          </pre>
        </div>
      )}
    </div>
  )
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const orderId = Number(id)

  const { data: order, isLoading: orderLoading } = useOrderDetail(orderId)
  const { data: regels, isLoading: regelsLoading } = useOrderRegels(orderId)
  const { data: levertijden } = useLevertijdVoorOrder(orderId)
  const { data: claims } = useClaimsVoorOrder(orderId)

  if (orderLoading) {
    return (
      <>
        <PageHeader title="Order laden..." />
        <div className="text-slate-400">Even geduld...</div>
      </>
    )
  }

  if (!order) {
    return (
      <>
        <PageHeader title="Order niet gevonden" />
        <Link to="/orders" className="text-terracotta-500 hover:underline">
          Terug naar orders
        </Link>
      </>
    )
  }

  return (
    <>
      <div className="mb-4">
        <Link
          to="/orders"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} />
          Terug naar orders
        </Link>
      </div>

      <PageHeader
        title={order.order_nr}
        actions={
          <ZendingAanmakenKnop
            order={{ id: order.id, status: order.status, debiteur_nr: order.debiteur_nr, afhalen: order.afhalen }}
          />
        }
      />

      <DocumentenCompact kind="order" parentId={order.id} className="mb-3" />

      {/* R1: productie-only orders (Basta) tonen bovenaan een afhandeling-hint.
          Rendert null voor gewone orders (gouden regel). */}
      <BastaAfhandelingPaneel
        alleenProductie={order.alleen_productie}
        oudOrderNr={order.oud_order_nr ?? null}
        status={order.status}
      />

      <OrderHeader order={order} locked={computeOrderLock(regels) === 'full'} />

      {order.bron_systeem === 'email' && order.opmerkingen && (
        <EmailInhoudPanel body={order.opmerkingen} />
      )}

      {isLeverweekTeBevestigen(order) && order.status !== 'Geannuleerd' && (
        <EdiLeverweekBevestigen
          orderId={order.id}
          gewenstIso={order.edi_gewenste_afleverdatum ?? null}
          afleverdatumIso={order.afleverdatum}
          orderStatus={order.status}
        />
      )}

      {/* Mig 322: onzekere (fuzzy) debiteur-match → bevestigen of corrigeren.
          env_fallback (verzameldebiteur) is bewust geen fout en valt af. */}
      {order.debiteur_zeker === false &&
        order.debiteur_match_bron !== 'env_fallback' &&
        order.status !== 'Geannuleerd' && (
          <DebiteurBevestigenWidget
            orderId={order.id}
            klantNaam={order.klant_naam ?? `Debiteur ${order.debiteur_nr}`}
            debiteurNr={order.debiteur_nr}
            matchBron={order.debiteur_match_bron}
          />
        )}

      <OrderAddresses order={order} />
      <OrderRegelsTable
        regels={regels ?? []}
        isLoading={regelsLoading}
        levertijden={levertijden}
        claims={claims}
        orderStatus={order.status}
        orderId={order.id}
        orderdatum={order.orderdatum}
      />
      <OrderEventsTijdlijn orderId={order.id} />
      <OrderFacturen orderId={order.id} />
    </>
  )
}
