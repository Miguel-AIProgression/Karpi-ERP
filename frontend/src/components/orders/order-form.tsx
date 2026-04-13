import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ClientSelector, type SelectedClient } from './client-selector'
import { AddressSelector } from './address-selector'
import { OrderLineEditor } from './order-line-editor'
import { createOrder, updateOrderWithLines, deleteOrder, lookupPrice, fetchKlanteigenNaam, fetchKlantArtikelnummer } from '@/lib/supabase/queries/order-mutations'
import type { OrderFormData, OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import { SHIPPING_PRODUCT_ID, SHIPPING_THRESHOLD, SHIPPING_COST } from '@/lib/constants/shipping'

function getISOWeek(dateStr: string): number {
  const date = new Date(dateStr)
  const tmp = new Date(date.getTime())
  tmp.setDate(tmp.getDate() + 4 - (tmp.getDay() || 7))
  const yearStart = new Date(tmp.getFullYear(), 0, 1)
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

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

  // In edit mode, if a VERZEND line already exists, preserve it (override=true)
  const [shippingOverridden, setShippingOverridden] = useState(
    () => mode === 'edit' && (initialData?.regels ?? []).some(r => r.artikelnr === SHIPPING_PRODUCT_ID)
  )

  /** Apply automatic shipping logic to a set of order lines. Returns new lines array. */
  function applyShippingLogic(currentRegels: OrderRegelFormData[], currentClient: SelectedClient | null): OrderRegelFormData[] {
    const subtotaal = currentRegels
      .filter(l => l.artikelnr !== SHIPPING_PRODUCT_ID)
      .reduce((sum, l) => sum + (l.bedrag ?? 0), 0)

    const drempel = currentClient?.verzend_drempel ?? SHIPPING_THRESHOLD
    const kosten = currentClient?.verzendkosten ?? SHIPPING_COST
    const needsShipping = subtotaal < drempel && !currentClient?.gratis_verzending
    const hasShippingLine = currentRegels.some(l => l.artikelnr === SHIPPING_PRODUCT_ID)

    if (needsShipping && !hasShippingLine) {
      const shippingLine: OrderRegelFormData = {
        artikelnr: SHIPPING_PRODUCT_ID,
        omschrijving: 'Verzendkosten',
        orderaantal: 1,
        te_leveren: 1,
        prijs: kosten,
        korting_pct: 0,
        bedrag: kosten,
      }
      return [...currentRegels, shippingLine]
    }

    if (!needsShipping && hasShippingLine) {
      return currentRegels.filter(l => l.artikelnr !== SHIPPING_PRODUCT_ID)
    }

    return currentRegels
  }

  // Auto-fill addresses when client is selected + reprice existing lines
  const handleClientChange = async (c: SelectedClient | null) => {
    setClient(c)
    setShippingOverridden(false)
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

      // Reprice existing order lines for the new customer
      if (regels.length > 0) {
        const nonShippingRegels = regels.filter(l => l.artikelnr !== SHIPPING_PRODUCT_ID)
        const updatedRegels = await Promise.all(
          nonShippingRegels.map(async (line) => {
            if (!line.artikelnr) return line

            // Lookup new price from customer's price list
            let newPrijs = line.prijs
            if (c.prijslijst_nr) {
              const prijsResult = await lookupPrice(c.prijslijst_nr, line.artikelnr)
              if (prijsResult !== null) newPrijs = prijsResult
            }

            // Lookup klant artikelnummer
            let klant_artikelnr: string | undefined
            const kanResult = await fetchKlantArtikelnummer(c.debiteur_nr, line.artikelnr)
            if (kanResult) klant_artikelnr = kanResult.klant_artikel

            const updated = {
              ...line,
              prijs: newPrijs,
              korting_pct: c.korting_pct ?? line.korting_pct,
              klant_artikelnr,
            }
            updated.bedrag = (updated.orderaantal ?? 0) * (updated.prijs ?? 0) *
              (1 - (updated.korting_pct ?? 0) / 100)
            updated.bedrag = Math.round(updated.bedrag * 100) / 100
            return updated
          })
        )
        setRegels(applyShippingLogic(updatedRegels, c))
      }
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

  // Price + customer-specific data lookup when article is added
  const handleArticleSelected = useCallback(async (article: { artikelnr: string; kwaliteit_code: string | null }) => {
    const debiteurNr = client?.debiteur_nr
    let prijs: number | null = null
    let klant_eigen_naam: string | null = null
    let klant_artikelnr: string | null = null

    // Lookup price from price list
    if (client?.prijslijst_nr) {
      prijs = await lookupPrice(client.prijslijst_nr, article.artikelnr)
    }

    if (debiteurNr) {
      // Lookup klanteigen naam (via kwaliteit_code)
      if (article.kwaliteit_code) {
        const kenResult = await fetchKlanteigenNaam(debiteurNr, article.kwaliteit_code)
        if (kenResult) klant_eigen_naam = kenResult.benaming
      }

      // Lookup klant artikelnummer
      const kanResult = await fetchKlantArtikelnummer(debiteurNr, article.artikelnr)
      if (kanResult) klant_artikelnr = kanResult.klant_artikel
    }

    return { prijs, klant_eigen_naam, klant_artikelnr }
  }, [client?.prijslijst_nr, client?.debiteur_nr])

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => deleteOrder(initialData!.orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      navigate('/orders')
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Verwijderen mislukt')
      setShowDeleteConfirm(false)
    },
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error('Selecteer een klant')
      if (regels.filter(r => r.artikelnr !== SHIPPING_PRODUCT_ID).length === 0) throw new Error('Voeg minstens één orderregel toe')

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
        <Field label="Afleverdatum" value={header.afleverdatum} onChange={(v) => {
          const week = v ? getISOWeek(v) : undefined
          setHeader({ ...header, afleverdatum: v, week: week ? String(week) : undefined })
        }} type="date" />
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
        prijslijstNr={client?.prijslijst_nr ?? undefined}
        onChange={(newRegels) => {
          // Detect manual changes to the VERZEND line
          const oldShipping = regels.find(l => l.artikelnr === SHIPPING_PRODUCT_ID)
          const newShipping = newRegels.find(l => l.artikelnr === SHIPPING_PRODUCT_ID)

          if (oldShipping && !newShipping) {
            // User removed the shipping line
            setShippingOverridden(true)
            setRegels(newRegels)
            return
          }

          if (oldShipping && newShipping && oldShipping.bedrag !== newShipping.bedrag) {
            // User edited the shipping line amount
            setShippingOverridden(true)
            setRegels(newRegels)
            return
          }

          // Normal change — apply shipping auto-logic if not overridden
          if (shippingOverridden) {
            setRegels(newRegels)
          } else {
            setRegels(applyShippingLogic(newRegels, client))
          }
        }}
        defaultKorting={client?.korting_pct ?? 0}
        onArticleSelected={handleArticleSelected}
      />

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !client || regels.filter(r => r.artikelnr !== SHIPPING_PRODUCT_ID).length === 0}
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

        {mode === 'edit' && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="ml-auto px-6 py-2 border border-rose-200 text-rose-600 rounded-[var(--radius-sm)] text-sm font-medium hover:bg-rose-50 transition-colors"
          >
            Verwijderen
          </button>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-[var(--radius)] shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Order verwijderen?</h3>
            <p className="text-sm text-slate-600 mb-6">
              Weet je zeker dat je deze order wilt verwijderen? Dit kan niet ongedaan worden gemaakt.
            </p>
            <div className="flex items-center gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 border border-slate-200 rounded-[var(--radius-sm)] text-sm hover:bg-slate-50"
              >
                Annuleren
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 bg-rose-600 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-rose-700 disabled:opacity-50 transition-colors"
              >
                {deleteMutation.isPending ? 'Verwijderen...' : 'Ja, verwijderen'}
              </button>
            </div>
          </div>
        </div>
      )}
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
