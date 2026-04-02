import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ClientSelector, type SelectedClient } from './client-selector'
import { AddressSelector } from './address-selector'
import { OrderLineEditor } from './order-line-editor'
import { createOrder, updateOrderWithLines, lookupPrice } from '@/lib/supabase/queries/order-mutations'
import type { OrderFormData, OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'

interface OrderFormProps {
  mode: 'create' | 'edit'
  initialData?: {
    orderId: number
    client: SelectedClient | null
    header: Partial<OrderFormData>
    regels: OrderRegelFormData[]
    status?: string
  }
}

export function OrderForm({ mode, initialData }: OrderFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [client, setClient] = useState<SelectedClient | null>(initialData?.client ?? null)
  const [header, setHeader] = useState<Partial<OrderFormData>>(initialData?.header ?? {})
  const [regels, setRegels] = useState<OrderRegelFormData[]>(initialData?.regels ?? [])
  const [error, setError] = useState<string | null>(null)

  // Auto-fill addresses when client is selected
  const handleClientChange = (c: SelectedClient | null) => {
    setClient(c)
    if (c) {
      setHeader((h) => ({
        ...h,
        debiteur_nr: c.debiteur_nr,
        vertegenw_code: c.vertegenw_code ?? undefined,
        betaler: c.betaler ?? undefined,
        inkooporganisatie: c.inkooporganisatie ?? undefined,
        fact_naam: c.fact_naam ?? c.naam,
        fact_adres: c.fact_adres ?? c.adres ?? undefined,
        fact_postcode: c.fact_postcode ?? c.postcode ?? undefined,
        fact_plaats: c.fact_plaats ?? c.plaats ?? undefined,
        fact_land: c.land ?? 'NL',
        afl_naam: c.naam,
        afl_adres: c.adres ?? undefined,
        afl_postcode: c.postcode ?? undefined,
        afl_plaats: c.plaats ?? undefined,
        afl_land: c.land ?? 'NL',
      }))
    }
  }

  const handleAddressSelect = (addr: { naam: string; adres: string; postcode: string; plaats: string; land: string }) => {
    setHeader((h) => ({
      ...h,
      afl_naam: addr.naam,
      afl_adres: addr.adres,
      afl_postcode: addr.postcode,
      afl_plaats: addr.plaats,
      afl_land: addr.land,
    }))
  }

  // Price lookup when article is added
  const handleArticleSelected = useCallback(async (article: { artikelnr: string }) => {
    if (!client?.prijslijst_nr) return null
    return lookupPrice(client.prijslijst_nr, article.artikelnr)
  }, [client?.prijslijst_nr])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error('Selecteer een klant')
      if (regels.length === 0) throw new Error('Voeg minstens één orderregel toe')

      const orderData: OrderFormData = { ...header, debiteur_nr: client.debiteur_nr }

      if (mode === 'create') {
        return createOrder(orderData, regels)
      } else {
        const orderId = initialData!.orderId
        await updateOrderWithLines(orderId, orderData, regels)
        return { id: orderId, order_nr: '' }
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      navigate(`/orders/${data.id}`)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Er ging iets mis')
    },
  })

  const isLocked = initialData?.status === 'Verzonden' || initialData?.status === 'Geannuleerd'

  if (isLocked) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-[var(--radius)] p-4 text-sm text-amber-700">
        Deze order heeft status "{initialData?.status}" en kan niet meer bewerkt worden.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-[var(--radius-sm)] p-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Client selection */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Klant *</label>
        <ClientSelector
          value={client}
          onChange={handleClientChange}
          disabled={mode === 'edit'}
        />
      </div>

      {/* Header fields */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="Klant referentie" value={header.klant_referentie} onChange={(v) => setHeader({ ...header, klant_referentie: v })} />
        <Field label="Afleverdatum" value={header.afleverdatum} onChange={(v) => setHeader({ ...header, afleverdatum: v })} type="date" />
        <Field label="Week" value={header.week} onChange={(v) => setHeader({ ...header, week: v })} />
      </div>

      {/* Address selector */}
      {client && (
        <AddressSelector
          debiteurNr={client.debiteur_nr}
          onSelect={handleAddressSelect}
        />
      )}

      {/* Address preview */}
      {header.afl_naam && (
        <div className="grid grid-cols-2 gap-4">
          <AddressPreview title="Factuuradres" naam={header.fact_naam} adres={header.fact_adres} postcode={header.fact_postcode} plaats={header.fact_plaats} />
          <AddressPreview title="Afleveradres" naam={header.afl_naam} adres={header.afl_adres} postcode={header.afl_postcode} plaats={header.afl_plaats} />
        </div>
      )}

      {/* Order lines */}
      <OrderLineEditor
        lines={regels}
        onChange={setRegels}
        defaultKorting={client?.korting_pct ?? 0}
        onArticleSelected={handleArticleSelected}
      />

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !client || regels.length === 0}
          className="px-6 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50 transition-colors"
        >
          {saveMutation.isPending ? 'Opslaan...' : mode === 'create' ? 'Order aanmaken' : 'Wijzigingen opslaan'}
        </button>
        <button
          type="button"
          onClick={() => navigate('/orders')}
          className="px-6 py-2 border border-slate-200 rounded-[var(--radius-sm)] text-sm hover:bg-slate-50"
        >
          Annuleren
        </button>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text' }: {
  label: string; value?: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
      />
    </div>
  )
}

function AddressPreview({ title, naam, adres, postcode, plaats }: {
  title: string; naam?: string; adres?: string; postcode?: string; plaats?: string
}) {
  return (
    <div className="bg-slate-50 rounded-[var(--radius-sm)] p-4">
      <div className="text-xs font-medium text-slate-500 mb-1">{title}</div>
      <div className="text-sm">
        {naam && <p className="font-medium">{naam}</p>}
        {adres && <p>{adres}</p>}
        <p>{[postcode, plaats].filter(Boolean).join(' ')}</p>
      </div>
    </div>
  )
}
