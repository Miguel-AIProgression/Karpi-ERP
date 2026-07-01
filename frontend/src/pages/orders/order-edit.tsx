import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { OrderForm } from '@/components/orders/order-form'
import { useOrderDetail, useOrderRegels } from '@/hooks/use-orders'
import { fetchClientCommercialData } from '@/lib/supabase/queries/order-mutations'
import { useHandmatigeKeuzesVoorOrder } from '@/modules/reserveringen'
import { computeOrderLock } from '@/lib/utils/order-lock'
import { AfwerkingOnlyEditor } from '@/components/orders/afwerking-only-editor'
import { DocumentenCompact } from '@/components/documenten/documenten-compact'
import type { SelectedClient } from '@/components/orders/client-selector'
import { hydrateerOrderRegels } from '@/lib/orders/order-hydratie'

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

  // Bestaande handmatige uitwisselbaar-claims om de form-state te hydrateren
  const { data: handmatigeKeuzes } = useHandmatigeKeuzesVoorOrder(orderId)

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

  const lockMode = computeOrderLock(regels)

  if (lockMode === 'full') {
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
        <PageHeader title={`Order ${order.order_nr} kan niet worden bewerkt`} />
        <div className="bg-amber-50 border border-amber-200 rounded-[var(--radius)] p-4 text-sm text-amber-900">
          Deze order is (deels) al gesneden en kan daarom niet meer worden gewijzigd.
        </div>
      </>
    )
  }

  if (lockMode === 'afwerking-only') {
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
        <PageHeader title={`Order ${order.order_nr} — afwerking toevoegen`} />
        <AfwerkingOnlyEditor orderId={orderId} regels={regels ?? []} />
      </>
    )
  }

  const client: SelectedClient | null = order.debiteur_nr ? {
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
    email_factuur: clientData?.email_factuur ?? null,
    email_overig: clientData?.email_overig ?? null,
    email_verzend: clientData?.email_verzend ?? null,
    email_pakbon: clientData?.email_pakbon ?? null,
    vertegenw_code: order.vertegenw_code,
    prijslijst_nr: clientData?.prijslijst_nr ?? null,
    korting_pct: clientData?.korting_pct ?? 0,
    betaler: order.betaler,
    inkooporganisatie: order.inkooporganisatie,
    gratis_verzending: clientData?.gratis_verzending ?? false,
    verzendkosten: clientData?.verzendkosten ?? 0,
    verzend_drempel: clientData?.verzend_drempel ?? 0,
    standaard_maat_werkdagen: clientData?.standaard_maat_werkdagen ?? null,
    maatwerk_weken: clientData?.maatwerk_weken ?? null,
    deelleveringen_toegestaan: clientData?.deelleveringen_toegestaan ?? false,
    default_lever_type: clientData?.default_lever_type ?? 'week',
    afleverwijze: clientData?.afleverwijze ?? null,
    toeslag_actief: clientData?.toeslag_actief ?? false,
    toeslag_procent: clientData?.toeslag_procent ?? null,
    toeslag_omschrijving: clientData?.toeslag_omschrijving ?? null,
    toeslag_begindatum: clientData?.toeslag_begindatum ?? null,
    toeslag_einddatum: clientData?.toeslag_einddatum ?? null,
    factuurvoorkeur: clientData?.factuurvoorkeur ?? null,
    combi_levering: clientData?.combi_levering ?? false,
  } : null

  // Order-hydratie: bestaande Order → form-state (zie lib/orders/order-hydratie.ts,
  // het "bron → order-form-state"-seam, spiegel van Order-commit). Draagt náást de
  // regel-velden óók de display-only producten-velden over (vrije_voorraad,
  // besteld_inkoop, is_pseudo, is_dropship). Vóór deze adapter ontbraken
  // vrije_voorraad/besteld_inkoop hier → berekenRegelDekking zag vrij=0 en meldde
  // een vals IO-tekort, waardoor de LeverModusDialog onterecht opende (ORD-2026-0614).
  const regelData = hydrateerOrderRegels(regels ?? [], handmatigeKeuzes ?? [])

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

      <DocumentenCompact kind="order" parentId={orderId} className="mb-3" />

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
            // E-mail-snapshots (mig 364) meegeven — anders wist elke
            // bewerking fact_email/afl_email (update-RPC zet ontbrekende
            // sleutels op NULL; incident ORD-2026-0350, 11-06-2026).
            fact_email: order.fact_email ?? undefined,
            afl_email: order.afl_email ?? undefined,
            afl_naam: order.afl_naam ?? undefined,
            afl_naam_2: order.afl_naam_2 ?? undefined,
            afl_adres: order.afl_adres ?? undefined,
            afl_postcode: order.afl_postcode ?? undefined,
            afl_plaats: order.afl_plaats ?? undefined,
            afl_land: order.afl_land ?? undefined,
            afhalen: order.afhalen ?? false,
            // lever_modus rehydrateren: anders is header.lever_modus altijd
            // undefined → de !header.lever_modus-guard in order-form opent de
            // LeverModusDialog opnieuw, én de update-RPC zet lever_modus op NULL
            // (zelfde wis-bug-klasse als de e-mail-snapshots hierboven).
            lever_modus: order.lever_modus ?? undefined,
          },
          regels: regelData,
          status: order.status,
        }}
      />
    </>
  )
}
