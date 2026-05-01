import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { OrderForm } from '@/components/orders/order-form'
import {
  DocumentenBuffer,
  type BufferedDoc,
} from '@/components/documenten/documenten-buffer'
import { uploadDocument } from '@/lib/supabase/queries/documenten'

export function OrderCreatePage() {
  const [bufferedDocs, setBufferedDocs] = useState<BufferedDoc[]>([])

  async function uploadBufferedDocs(orderIds: number[]) {
    if (bufferedDocs.length === 0) return
    // Bij split-orders koppelen we elke buffered doc aan beide order-id's
    // zodat de gebruiker ze in beide orders terugvindt.
    for (const orderId of orderIds) {
      for (const d of bufferedDocs) {
        await uploadDocument('order', orderId, d.file, d.omschrijving)
      }
    }
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

      <PageHeader title="Nieuwe order" />

      <OrderForm mode="create" onAfterCreate={uploadBufferedDocs} />

      <div className="mt-6">
        <DocumentenBuffer
          docs={bufferedDocs}
          onChange={setBufferedDocs}
          title="Documenten (klant-PO, bevestiging, bijlagen)"
        />
      </div>
    </>
  )
}
