import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { OrderForm } from '@/components/orders/order-form'
import { PoPrefillBanner } from '@/components/orders/po-prefill-banner'
import {
  DocumentenBuffer,
  type BufferedDoc,
} from '@/components/documenten/documenten-buffer'
import { uploadDocument } from '@/lib/supabase/queries/documenten'
import { usePoParsing } from '@/hooks/use-po-parsing'
import { fetchSelectedClientVoorPrefill } from '@/lib/supabase/queries/po-parsing'
import { mapMatchNaarPrefill, type PoPrefill } from '@/lib/orders/po-prefill'
import type { SelectedClient } from '@/components/orders/client-selector'

export function OrderCreatePage() {
  const [bufferedDocs, setBufferedDocs] = useState<BufferedDoc[]>([])
  const [formKey, setFormKey] = useState(0)
  const [prefill, setPrefill] = useState<PoPrefill | null>(null)
  const [prefillClient, setPrefillClient] = useState<SelectedClient | null>(null)
  const [prefillBron, setPrefillBron] = useState<string>('')
  const [parsingId, setParsingId] = useState<string | null>(null)
  const [parseFout, setParseFout] = useState<string | null>(null)

  const poParsing = usePoParsing()

  async function uploadBufferedDocs(orderIds: number[]) {
    if (bufferedDocs.length === 0) return
    for (const orderId of orderIds) {
      for (const d of bufferedDocs) {
        await uploadDocument('order', orderId, d.file, d.omschrijving)
      }
    }
  }

  async function handleParse(doc: BufferedDoc) {
    setParseFout(null)
    setParsingId(doc.id)
    try {
      const { match } = await poParsing.mutateAsync(doc.file)
      const mapped = mapMatchNaarPrefill(match)
      let client: SelectedClient | null = null
      if (mapped.samenvatting.debiteurZeker && mapped.samenvatting.debiteurNr != null) {
        client = await fetchSelectedClientVoorPrefill(mapped.samenvatting.debiteurNr)
      }
      setPrefill(mapped)
      setPrefillClient(client)
      setPrefillBron(doc.file.name)
      setFormKey((k) => k + 1)
    } catch (err) {
      setParseFout(err instanceof Error ? err.message : 'Parsen mislukt')
    } finally {
      setParsingId(null)
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

      {parseFout && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-[var(--radius-sm)]">
          {parseFout}
        </div>
      )}

      {prefill && (
        <PoPrefillBanner
          bestandsnaam={prefillBron}
          samenvatting={prefill.samenvatting}
          onClose={() => setPrefill(null)}
        />
      )}

      <OrderForm
        key={formKey}
        mode="create"
        onAfterCreate={uploadBufferedDocs}
        initialData={
          prefill
            ? {
                orderId: 0,
                client: prefillClient,
                header: prefill.header,
                regels: prefill.regels,
              }
            : undefined
        }
      />

      <div className="mt-6">
        <DocumentenBuffer
          docs={bufferedDocs}
          onChange={setBufferedDocs}
          title="Documenten (klant-PO, bevestiging, bijlagen)"
          onParse={handleParse}
          parsingId={parsingId}
        />
      </div>
    </>
  )
}
