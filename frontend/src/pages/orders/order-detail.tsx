import { useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { OrderHeader } from '@/components/orders/order-header'
import { OrderAddresses } from '@/components/orders/order-addresses'
import { OrderRegelsTable } from '@/components/orders/order-regels-table'
import { ZendingAanmakenKnop } from '@/components/orders/zending-aanmaken-knop'
import { useOrderDetail, useOrderRegels } from '@/hooks/use-orders'
import { useLevertijdVoorOrder, useClaimsVoorOrder } from '@/hooks/use-reserveringen'
import { computeOrderLock } from '@/lib/utils/order-lock'

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
            order={{ id: order.id, status: order.status, debiteur_nr: order.debiteur_nr }}
          />
        }
      />

      <OrderHeader order={order} locked={computeOrderLock(regels) === 'full'} />
      <OrderAddresses order={order} />
      <OrderRegelsTable regels={regels ?? []} isLoading={regelsLoading} levertijden={levertijden} claims={claims} />
    </>
  )
}
