import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { PageHeader } from '@/components/layout/page-header'
import { InfoField } from '@/components/ui/info-field'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency } from '@/lib/utils/formatters'
import { useKlantDetail, useAfleveradressen } from '@/hooks/use-klanten'
import { useOrders } from '@/hooks/use-orders'
import { KlanteigenNamenTab } from '@/components/klanten/klanteigen-namen-tab'
import { KlantArtikelnummersTab } from '@/components/klanten/klant-artikelnummers-tab'
import { KlantPrijslijstTab } from '@/components/klanten/klant-prijslijst-tab'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

type Tab = 'info' | 'adressen' | 'orders' | 'eigennamen' | 'artikelnummers' | 'prijslijst'

const TABS: { key: Tab; label: string }[] = [
  { key: 'info', label: 'Info' },
  { key: 'adressen', label: 'Afleveradressen' },
  { key: 'orders', label: 'Orders' },
  { key: 'eigennamen', label: 'Klanteigen namen' },
  { key: 'artikelnummers', label: 'Artikelnummers' },
  { key: 'prijslijst', label: 'Prijslijst' },
]

export function KlantDetailPage() {
  const { id } = useParams<{ id: string }>()
  const debiteurNr = Number(id)
  const [activeTab, setActiveTab] = useState<Tab>('info')
  const [showLogo, setShowLogo] = useState(false)

  const queryClient = useQueryClient()
  const { data: klant, isLoading } = useKlantDetail(debiteurNr)
  const { data: adressen } = useAfleveradressen(debiteurNr)
  const { data: ordersData } = useOrders({ debiteurNr, pageSize: 1000 })

  const gratisVerzendingMutation = useMutation({
    mutationFn: async (newValue: boolean) => {
      const { error } = await supabase
        .from('debiteuren')
        .update({ gratis_verzending: newValue })
        .eq('debiteur_nr', debiteurNr)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['klanten', debiteurNr] })
    },
  })

  if (isLoading) {
    return <PageHeader title="Klant laden..." />
  }

  if (!klant) {
    return (
      <>
        <PageHeader title="Klant niet gevonden" />
        <Link to="/klanten" className="text-terracotta-500 hover:underline">
          Terug naar klanten
        </Link>
      </>
    )
  }

  return (
    <>
      <div className="mb-4">
        <Link
          to="/klanten"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} />
          Terug naar klanten
        </Link>
      </div>

      {/* Header card */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6 mb-6">
        <div className="flex items-start gap-4 mb-4">
          {/* Logo / initialen */}
          {klant.logo_path ? (
            <button onClick={() => setShowLogo(true)} className="cursor-zoom-in">
              <img
                src={`${SUPABASE_URL}/storage/v1/object/public/logos/${klant.debiteur_nr}.jpg`}
                alt={klant.naam}
                className="w-16 h-16 rounded-[var(--radius-sm)] object-contain bg-slate-50 border border-slate-100"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </button>
          ) : (
            <div className="w-16 h-16 rounded-[var(--radius-sm)] bg-slate-100 flex items-center justify-center text-lg font-medium text-slate-400">
              {klant.naam.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()}
            </div>
          )}

          <div className="flex-1">
            <h1 className="text-xl font-semibold text-slate-900 mb-1">{klant.naam}</h1>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-400">#{klant.debiteur_nr}</span>
              <StatusBadge status={klant.status} type="order" />
              <StatusBadge status={klant.tier} type="tier" />
              {klant.vertegenwoordiger_naam && (
                <span className="text-sm text-slate-500">
                  Verteg: <span className="font-medium text-slate-700">{klant.vertegenwoordiger_naam}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <InfoField label="Adres" value={[klant.adres, `${klant.postcode ?? ''} ${klant.plaats ?? ''}`.trim()].filter(Boolean).join(', ')} />
          <InfoField label="Telefoon" value={klant.telefoon} />
          <InfoField label="Email" value={klant.email_factuur} />
          <InfoField label="BTW" value={klant.btw_nummer} />
          <InfoField label="Prijslijst" value={klant.prijslijst_nr} />
          <InfoField label="Korting" value={klant.korting_pct ? `${klant.korting_pct}%` : null} />
          <InfoField label="Betaalconditie" value={klant.betaalconditie} />
          <InfoField label="Omzet YTD" value={formatCurrency(klant.omzet_ytd)} />
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700">Gratis verzending</label>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
            klant.gratis_verzending
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-slate-100 text-slate-500'
          }`}>
            {klant.gratis_verzending ? 'Ja' : 'Nee'}
          </span>
          <button
            onClick={() => gratisVerzendingMutation.mutate(!klant.gratis_verzending)}
            disabled={gratisVerzendingMutation.isPending}
            className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium disabled:opacity-50"
          >
            {gratisVerzendingMutation.isPending ? 'Opslaan...' : 'Wijzig'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 mb-4">
        <nav className="flex gap-1 -mb-px">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-terracotta-500 text-terracotta-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200">
        {activeTab === 'info' && <InfoTab klant={klant} />}
        {activeTab === 'adressen' && <AdressenTab adressen={adressen} />}
        {activeTab === 'orders' && <OrdersTab orders={ordersData?.orders} totalCount={ordersData?.totalCount} />}
        {activeTab === 'eigennamen' && <KlanteigenNamenTab debiteurNr={debiteurNr} />}
        {activeTab === 'artikelnummers' && <KlantArtikelnummersTab debiteurNr={debiteurNr} />}
        {activeTab === 'prijslijst' && <KlantPrijslijstTab debiteurNr={debiteurNr} />}
      </div>

      {/* Logo lightbox */}
      {showLogo && klant.logo_path && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowLogo(false)}
        >
          <div className="relative max-w-lg max-h-[80vh] p-2 bg-white rounded-[var(--radius)] shadow-xl">
            <button
              onClick={() => setShowLogo(false)}
              className="absolute -top-3 -right-3 w-8 h-8 flex items-center justify-center rounded-full bg-white shadow-md text-slate-500 hover:text-slate-700"
            >
              <X size={16} />
            </button>
            <img
              src={`${SUPABASE_URL}/storage/v1/object/public/logos/${klant.debiteur_nr}.jpg`}
              alt={klant.naam}
              className="max-w-full max-h-[75vh] object-contain"
            />
          </div>
        </div>
      )}
    </>
  )
}

function InfoTab({ klant }: { klant: NonNullable<ReturnType<typeof useKlantDetail>['data']> }) {
  return (
    <div className="p-5 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
      <InfoField label="Vertegenwoordiger" value={klant.vertegenwoordiger_naam ?? klant.vertegenw_code} />
      <InfoField label="Route" value={klant.route} />
      <InfoField label="Rayon" value={klant.rayon_naam} />
      <InfoField label="Factuur naam" value={klant.fact_naam} />
      <InfoField label="Factuur adres" value={[klant.fact_adres, `${klant.fact_postcode ?? ''} ${klant.fact_plaats ?? ''}`.trim()].filter(Boolean).join(', ')} />
      <InfoField label="Email (overig)" value={klant.email_overig} />
      <InfoField label="Email 2" value={klant.email_2} />
      <InfoField label="Fax" value={klant.fax} />
      <InfoField label="GLN" value={klant.gln_bedrijf} />
      <InfoField label="Land" value={klant.land} />
    </div>
  )
}

function AdressenTab({ adressen }: { adressen?: { id: number; adres_nr: number; naam: string | null; adres: string | null; postcode: string | null; plaats: string | null }[] }) {
  if (!adressen || adressen.length === 0) {
    return <div className="p-5 text-sm text-slate-400">Geen afleveradressen</div>
  }
  return (
    <div className="divide-y divide-slate-50">
      {adressen.map((a) => (
        <div key={a.id} className="px-5 py-3 text-sm">
          <span className="text-slate-400 mr-2">#{a.adres_nr}</span>
          <span className="font-medium">{a.naam}</span>
          {a.adres && <span className="text-slate-500"> — {a.adres}, {a.postcode} {a.plaats}</span>}
        </div>
      ))}
    </div>
  )
}

function OrdersTab({ orders, totalCount }: { orders?: { id: number; order_nr: string; totaal_bedrag: number; status: string }[]; totalCount?: number }) {
  const PAGE_SIZE = 20
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  if (!orders || orders.length === 0) {
    return <div className="p-5 text-sm text-slate-400">Nog geen orders</div>
  }

  const total = totalCount ?? orders.length
  const shown = Math.min(visibleCount, orders.length)

  return (
    <>
      <div className="px-5 py-3 border-b border-slate-100 text-xs text-slate-400">
        {total} orders totaal
      </div>
      <div className="divide-y divide-slate-50">
        {orders.slice(0, shown).map((o) => (
          <Link
            key={o.id}
            to={`/orders/${o.id}`}
            className="flex items-center justify-between px-5 py-3 text-sm hover:bg-slate-50"
          >
            <span className="text-terracotta-500 font-medium">{o.order_nr}</span>
            <span className="text-slate-500">{formatCurrency(o.totaal_bedrag)}</span>
            <StatusBadge status={o.status} />
          </Link>
        ))}
      </div>
      {shown < orders.length && (
        <button
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          className="w-full py-3 text-sm text-terracotta-500 hover:bg-slate-50 border-t border-slate-100"
        >
          Meer laden ({orders.length - shown} resterend)
        </button>
      )}
    </>
  )
}
