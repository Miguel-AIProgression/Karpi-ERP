import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { OrderForm } from '@/components/orders/order-form'
import { useOrderDetail, useOrderRegels } from '@/hooks/use-orders'
import { fetchClientCommercialData } from '@/lib/supabase/queries/order-mutations'
import type { SelectedClient } from '@/components/orders/client-selector'
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'

export function OrderEditPage() {
  const { id } = useParams<{ id: string }>()
  const orderId = Number(id)

  const { data: order, isLoading: orderLoading } = useOrderDetail(orderId)
  const { data: regels, isLoading: regelsLoading } = useOrderRegels(orderId)

  // Fetch client's prijslijst_nr and korting_pct for price lookups on new lines
  const { data: clientData } = useQuery({
    queryKey: ['client-commercial', order?.debiteur_nr],
    queryFn: () => fetchClientCommercialData(order!.debiteur_nr),
    enabled: !!order?.debiteur_nr,
  })

  if (orderLoading || regelsLoading) {
    return <PageHeader title="Order laden..." />
  }

  if (!order) {
    return (
      <>
        <PageHeader title="Order niet gevonden" />
        <Link to="/orders" className="text-terracotta-500 hover:underline">Terug</Link>
      </>
    )
  }

  const client: SelectedClient = {
    debiteur_nr: order.debiteur_nr,
    naam: order.klant_naam ?? '',
    adres: null,
    postcode: null,
    plaats: null,
    land: null,
    fact_naam: order.fact_naam,
    fact_adres: order.fact_adres,
    fact_postcode: order.fact_postcode,
    fact_plaats: order.fact_plaats,
    vertegenw_code: order.vertegenw_code,
    prijslijst_nr: clientData?.prijslijst_nr ?? null,
    korting_pct: clientData?.korting_pct ?? 0,
    betaler: order.betaler,
    inkooporganisatie: order.inkooporganisatie,
    gratis_verzending: clientData?.gratis_verzending ?? false,
  }

  const regelData: OrderRegelFormData[] = (regels ?? []).map((r) => ({
    artikelnr: r.artikelnr ?? undefined,
    karpi_code: r.karpi_code ?? undefined,
    omschrijving: r.omschrijving,
    omschrijving_2: r.omschrijving_2 ?? undefined,
    orderaantal: r.orderaantal,
    te_leveren: r.te_leveren,
    prijs: r.prijs ?? undefined,
    korting_pct: r.korting_pct,
    bedrag: r.bedrag ?? undefined,
    gewicht_kg: r.gewicht_kg ?? undefined,
  }))

  return (
    <>
      <div className="mb-4">
        <Link
          to={`/orders/${orderId}`}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} />
          Terug naar order
        </Link>
      </div>

      <PageHeader title={`Order ${order.order_nr} bewerken`} />

      <OrderForm
        mode="edit"
        initialData={{
          orderId,
          client,
          header: {
            debiteur_nr: order.debiteur_nr,
            klant_referentie: order.klant_referentie ?? undefined,
            afleverdatum: order.afleverdatum ?? undefined,
            week: order.week ?? undefined,
            vertegenw_code: order.vertegenw_code ?? undefined,
            betaler: order.betaler ?? undefined,
            inkooporganisatie: order.inkooporganisatie ?? undefined,
            fact_naam: order.fact_naam ?? undefined,
            fact_adres: order.fact_adres ?? undefined,
            fact_postcode: order.fact_postcode ?? undefined,
            fact_plaats: order.fact_plaats ?? undefined,
            fact_land: order.fact_land ?? undefined,
            afl_naam: order.afl_naam ?? undefined,
            afl_naam_2: order.afl_naam_2 ?? undefined,
            afl_adres: order.afl_adres ?? undefined,
            afl_postcode: order.afl_postcode ?? undefined,
            afl_plaats: order.afl_plaats ?? undefined,
            afl_land: order.afl_land ?? undefined,
          },
          regels: regelData,
          status: order.status,
        }}
      />
    </>
  )
}
