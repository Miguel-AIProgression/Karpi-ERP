import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Mail, Phone } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { formatCurrency } from '@/lib/utils/formatters'
import { useVertegDetail, useVertegMaandomzet } from '@/hooks/use-vertegenwoordigers'
import { OmzetTrend } from '@/components/vertegenwoordigers/omzet-trend'
import { VertegKlantenTab } from '@/components/vertegenwoordigers/verteg-klanten-tab'
import { VertegOrdersTab } from '@/components/vertegenwoordigers/verteg-orders-tab'

type Tab = 'klanten' | 'orders'

export function VertegenwoordigerDetailPage() {
  const { code } = useParams<{ code: string }>()
  const [activeTab, setActiveTab] = useState<Tab>('klanten')

  const { data: verteg, isLoading } = useVertegDetail(code ?? '')
  const { data: maandomzet, isLoading: trendLoading } = useVertegMaandomzet(code ?? '')

  if (isLoading) {
    return <PageHeader title="Laden..." />
  }

  if (!verteg) {
    return (
      <>
        <PageHeader title="Vertegenwoordiger niet gevonden" />
        <Link to="/vertegenwoordigers" className="text-terracotta-500 hover:underline">
          Terug naar overzicht
        </Link>
      </>
    )
  }

  return (
    <>
      <div className="mb-4">
        <Link
          to="/vertegenwoordigers"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} />
          Terug naar vertegenwoordigers
        </Link>
      </div>

      <PageHeader title={verteg.naam} />

      {/* Header card */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-4 mb-5">
          <span className="text-sm text-slate-400">Code: {verteg.code}</span>
          {verteg.email && (
            <span className="inline-flex items-center gap-1 text-sm text-slate-500">
              <Mail size={14} /> {verteg.email}
            </span>
          )}
          {verteg.telefoon && (
            <span className="inline-flex items-center gap-1 text-sm text-slate-500">
              <Phone size={14} /> {verteg.telefoon}
            </span>
          )}
          {!verteg.actief && (
            <span className="px-2 py-0.5 text-xs rounded bg-slate-200 text-slate-500">Inactief</span>
          )}
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Omzet YTD" value={formatCurrency(verteg.omzet_ytd)} />
          <StatCard label="Klanten" value={String(verteg.aantal_klanten)} />
          <StatCard
            label="Open orders"
            value={String(verteg.open_orders)}
            highlight={verteg.open_orders > 0}
          />
          <StatCard label="Gem. orderwaarde" value={formatCurrency(verteg.gem_orderwaarde)} />
        </div>
      </div>

      {/* Omzet trend */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5 mb-6">
        <h3 className="font-medium text-slate-900 mb-3">Omzet per maand ({new Date().getFullYear()})</h3>
        <OmzetTrend data={maandomzet ?? []} isLoading={trendLoading} />
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 mb-4">
        <nav className="flex gap-1 -mb-px">
          <TabButton active={activeTab === 'klanten'} onClick={() => setActiveTab('klanten')}>
            Klanten
          </TabButton>
          <TabButton active={activeTab === 'orders'} onClick={() => setActiveTab('orders')}>
            Orders
          </TabButton>
        </nav>
      </div>

      <div className="bg-white rounded-[var(--radius)] border border-slate-200">
        {activeTab === 'klanten' && <VertegKlantenTab code={code ?? ''} />}
        {activeTab === 'orders' && <VertegOrdersTab code={code ?? ''} />}
      </div>
    </>
  )
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-slate-50 rounded-[var(--radius-sm)] p-4">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-lg font-semibold ${highlight ? 'text-amber-600' : 'text-slate-900'}`}>
        {value}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-terracotta-500 text-terracotta-600'
          : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
      }`}
    >
      {children}
    </button>
  )
}
