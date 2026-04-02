import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { OrderForm } from '@/components/orders/order-form'

export function OrderCreatePage() {
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

      <PageHeader title="Nieuwe order" />

      <OrderForm mode="create" />
    </>
  )
}
