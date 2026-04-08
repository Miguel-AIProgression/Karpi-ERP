import { useState } from 'react'
import { Search, Warehouse, Scissors, CheckCircle2, PackageCheck, Euro } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { cn } from '@/lib/utils/cn'
import { SNIJPLAN_STATUS_COLORS } from '@/lib/utils/constants'
import { useMagazijnItems, useMagazijnStats } from '@/hooks/use-magazijn'
import type { MagazijnItem } from '@/lib/types/productie'

type TabFilter = 'Alles' | 'Op maat' | 'Standaard'

const TAB_TO_TYPE: Record<TabFilter, MagazijnItem['type'] | undefined> = {
  'Alles': undefined,
  'Op maat': 'op_maat',
  'Standaard': 'standaard',
}

function TypeBadge({ type }: { type: MagazijnItem['type'] }) {
  return type === 'op_maat' ? (
    <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">
      Op maat
    </span>
  ) : (
    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
      Standaard
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors = SNIJPLAN_STATUS_COLORS[status] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', colors.bg, colors.text)}>
      {status}
    </span>
  )
}

export function MagazijnOverviewPage() {
  const [tab, setTab] = useState<TabFilter>('Alles')
  const [search, setSearch] = useState('')

  const { data: stats } = useMagazijnStats()
  const { data: result, isLoading } = useMagazijnItems({
    type: TAB_TO_TYPE[tab],
    search: search || undefined,
  })

  const items = result?.items ?? []

  const statCards = [
    { label: 'Totaal in magazijn', value: stats?.totaal ?? 0, icon: Warehouse, color: 'text-slate-700' },
    { label: 'Gesneden', value: stats?.gesneden ?? 0, icon: Scissors, color: 'text-amber-600' },
    { label: 'Afgewerkt', value: stats?.afgewerkt ?? 0, icon: CheckCircle2, color: 'text-emerald-600' },
    { label: 'Ingepakt', value: stats?.ingepakt ?? 0, icon: PackageCheck, color: 'text-teal-600' },
    {
      label: 'Voorraadwaarde',
      value: `\u20AC ${(stats?.voorraadwaarde ?? 0).toLocaleString('nl-NL', { minimumFractionDigits: 2 })}`,
      icon: Euro,
      color: 'text-slate-700',
    },
  ]

  const tabs: TabFilter[] = ['Alles', 'Op maat', 'Standaard']

  // Count items per tab
  const allItems = result?.items ?? []
  const tabCounts: Record<TabFilter, number> = {
    'Alles': allItems.length,
    'Op maat': allItems.filter((i) => i.type === 'op_maat').length,
    'Standaard': allItems.filter((i) => i.type === 'standaard').length,
  }

  return (
    <>
      <PageHeader
        title="Magazijn"
        description="Gereed product — gesneden, wacht op verzending"
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {statCards.map((s) => (
          <div key={s.label} className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon size={16} className={s.color} />
              <span className="text-sm text-slate-500">{s.label}</span>
            </div>
            <p className="text-2xl font-semibold">{typeof s.value === 'number' ? s.value : s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-1">
          {tabs.map((t) => {
            const isActive = tab === t
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors',
                  isActive
                    ? 'bg-terracotta-500 text-white font-medium'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                )}
              >
                {t}
                <span className={cn('text-xs px-1.5 py-0.5 rounded-full', isActive ? 'bg-white/20' : 'bg-slate-200')}>
                  {tabCounts[t]}
                </span>
              </button>
            )
          })}
        </div>
        <div className="relative w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek op sticker, order, klant, product..."
            className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Magazijn laden...
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Geen items in magazijn gevonden
        </div>
      ) : (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                  <th className="py-2.5 px-3 font-medium">Type</th>
                  <th className="py-2.5 px-3 font-medium">Sticker</th>
                  <th className="py-2.5 px-3 font-medium">Order</th>
                  <th className="py-2.5 px-3 font-medium">Klant</th>
                  <th className="py-2.5 px-3 font-medium">Product</th>
                  <th className="py-2.5 px-3 font-medium">Maat (cm)</th>
                  <th className="py-2.5 px-3 font-medium text-right">m&sup2;</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium">Locatie</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item, idx) => (
                  <tr key={item.snijplan_id ?? idx} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3">
                      <TypeBadge type={item.type} />
                    </td>
                    <td className="py-2 px-3 font-mono text-xs">{item.scancode ?? '—'}</td>
                    <td className="py-2 px-3 font-medium text-terracotta-600">{item.order_nr}</td>
                    <td className="py-2 px-3 text-slate-700">{item.klant_naam}</td>
                    <td className="py-2 px-3">
                      <span className="text-slate-700">{item.product}</span>
                      {item.kleur && (
                        <span className="text-slate-400 ml-1 text-xs">({item.kleur})</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-slate-600">{item.maat_cm}</td>
                    <td className="py-2 px-3 text-right">{item.m2.toFixed(2)}</td>
                    <td className="py-2 px-3">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="py-2 px-3">
                      {item.locatie ? (
                        <span className="text-slate-600">{item.locatie}</span>
                      ) : (
                        <button className="text-xs text-terracotta-500 hover:text-terracotta-600">
                          + locatie
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
