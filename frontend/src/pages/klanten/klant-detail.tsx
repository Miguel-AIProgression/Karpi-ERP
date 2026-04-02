import { useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { InfoField } from '@/components/ui/info-field'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency } from '@/lib/utils/formatters'
import { useKlantDetail, useAfleveradressen } from '@/hooks/use-klanten'
import { useOrders } from '@/hooks/use-orders'

export function KlantDetailPage() {
  const { id } = useParams<{ id: string }>()
  const debiteurNr = Number(id)

  const { data: klant, isLoading } = useKlantDetail(debiteurNr)
  const { data: adressen } = useAfleveradressen(debiteurNr)
  const { data: ordersData } = useOrders({ debiteurNr })

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

      <PageHeader title={klant.naam} />

      {/* Header card */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-slate-400">#{klant.debiteur_nr}</span>
          <StatusBadge status={klant.status} type="order" />
          <StatusBadge status={klant.tier} type="tier" />
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
      </div>

      {/* Afleveradressen */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 mb-6">
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="font-medium">Afleveradressen ({adressen?.length ?? 0})</h3>
        </div>
        {adressen && adressen.length > 0 ? (
          <div className="divide-y divide-slate-50">
            {adressen.map((a) => (
              <div key={a.id} className="px-5 py-3 text-sm">
                <span className="text-slate-400 mr-2">#{a.adres_nr}</span>
                <span className="font-medium">{a.naam}</span>
                {a.adres && <span className="text-slate-500"> — {a.adres}, {a.postcode} {a.plaats}</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="p-5 text-sm text-slate-400">Geen afleveradressen</div>
        )}
      </div>

      {/* Recent orders */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200">
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="font-medium">Recente orders ({ordersData?.totalCount ?? 0})</h3>
        </div>
        {ordersData?.orders && ordersData.orders.length > 0 ? (
          <div className="divide-y divide-slate-50">
            {ordersData.orders.slice(0, 10).map((o) => (
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
        ) : (
          <div className="p-5 text-sm text-slate-400">Nog geen orders</div>
        )}
      </div>
    </>
  )
}

