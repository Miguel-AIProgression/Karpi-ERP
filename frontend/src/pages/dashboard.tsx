import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/layout/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency, formatDate, formatNumber, formatPercentage } from '@/lib/utils/formatters'
import { useDashboardStats, useRecenteOrders } from '@/hooks/use-dashboard'

export function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useDashboardStats()
  const { data: recenteOrders, isLoading: ordersLoading } = useRecenteOrders()

  return (
    <>
      <PageHeader title="Dashboard" description="Overzicht van RugFlow ERP" />

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Open orders"
          value={statsLoading ? '...' : formatNumber(stats?.open_orders ?? 0)}
          linkTo="/orders"
        />
        <StatCard
          label="Actie vereist"
          value={statsLoading ? '...' : formatNumber(stats?.actie_vereist_orders ?? 0)}
          accent={!!stats?.actie_vereist_orders}
          linkTo="/orders"
        />
        <StatCard
          label="Actieve klanten"
          value={statsLoading ? '...' : formatNumber(stats?.actieve_klanten ?? 0)}
          linkTo="/klanten"
        />
        <StatCard
          label="Beschikbare rollen"
          value={statsLoading ? '...' : formatNumber(stats?.beschikbare_rollen ?? 0)}
          linkTo="/rollen"
        />
        <StatCard
          label="Voorraadwaarde (inkoop)"
          value={statsLoading ? '...' : formatCurrency(stats?.voorraadwaarde_inkoop ?? 0)}
        />
        <StatCard
          label="Voorraadwaarde (verkoop)"
          value={statsLoading ? '...' : formatCurrency(stats?.voorraadwaarde_verkoop ?? 0)}
        />
        <StatCard
          label="Gemiddelde marge"
          value={statsLoading ? '...' : formatPercentage(stats?.gemiddelde_marge_pct ?? 0)}
        />
        <StatCard
          label="In productie"
          value={statsLoading ? '...' : formatNumber(stats?.in_productie ?? 0)}
        />
      </div>

      {/* Recente orders */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-medium">Recente orders</h3>
          <Link to="/orders" className="text-sm text-terracotta-500 hover:underline">
            Alle orders bekijken
          </Link>
        </div>

        {ordersLoading ? (
          <div className="p-8 text-center text-slate-400">Laden...</div>
        ) : !recenteOrders?.length ? (
          <div className="p-8 text-center text-slate-400">Nog geen orders</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2 font-medium text-slate-600">Order</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Klant</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Datum</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">Bedrag</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {recenteOrders.map((o) => (
                <tr key={o.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link to={`/orders/${o.id}`} className="text-terracotta-500 hover:underline font-medium">
                      {o.order_nr}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <Link to={`/klanten/${o.debiteur_nr}`} className="hover:text-terracotta-500">
                      {o.klant_naam}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{formatDate(o.orderdatum)}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatCurrency(o.totaal_bedrag)}</td>
                  <td className="px-4 py-2"><StatusBadge status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function StatCard({ label, value, linkTo, accent }: {
  label: string; value: string; linkTo?: string; accent?: boolean
}) {
  const content = (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5 hover:shadow-sm transition-shadow">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 font-[family-name:var(--font-display)] ${accent ? 'text-rose-500' : ''}`}>
        {value}
      </div>
    </div>
  )

  if (linkTo) {
    return <Link to={linkTo}>{content}</Link>
  }
  return content
}
