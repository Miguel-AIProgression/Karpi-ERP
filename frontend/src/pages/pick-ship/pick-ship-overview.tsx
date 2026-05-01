import { useMemo, useState } from 'react'
import { Search, Package, AlertTriangle, Calendar } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { OrderPickCard } from '@/components/pick-ship/order-pick-card'
import { usePickShipOrders, usePickShipStats } from '@/hooks/use-pick-ship'
import { cn } from '@/lib/utils/cn'
import {
  BUCKET_LABEL,
  BUCKET_VOLGORDE,
  type BucketKey,
} from '@/lib/types/pick-ship'

type FilterTab = 'alles' | BucketKey

export function PickShipOverviewPage() {
  const [filter, setFilter] = useState<FilterTab>('alles')
  const [search, setSearch] = useState('')

  const { data: stats } = usePickShipStats()
  const { data: orders, isLoading } = usePickShipOrders({
    search: search || undefined,
  })

  const gefilterd = useMemo(() => {
    if (!orders) return []
    if (filter === 'alles') return orders
    return orders.filter((o) => o.bucket === filter)
  }, [orders, filter])

  const perBucket = useMemo(() => {
    const m = new Map<BucketKey, typeof gefilterd>()
    for (const k of BUCKET_VOLGORDE) m.set(k, [])
    for (const o of gefilterd) m.get(o.bucket)!.push(o)
    return m
  }, [gefilterd])

  const statCards = [
    {
      label: 'Open orders',
      value: stats?.totaal_orders ?? 0,
      icon: Package,
      color: 'text-teal-600',
    },
    {
      label: 'Achterstallig',
      value: stats?.per_bucket.achterstallig ?? 0,
      icon: AlertTriangle,
      color: 'text-rose-600',
    },
    {
      label: 'Vandaag + morgen',
      value: (stats?.per_bucket.vandaag ?? 0) + (stats?.per_bucket.morgen ?? 0),
      icon: Calendar,
      color: 'text-amber-600',
    },
  ]

  const tabs: { key: FilterTab; label: string; aantal: number }[] = [
    { key: 'alles', label: 'Alles', aantal: stats?.totaal_orders ?? 0 },
    ...BUCKET_VOLGORDE.map((k) => ({
      key: k,
      label: BUCKET_LABEL[k],
      aantal: stats?.per_bucket[k] ?? 0,
    })),
  ]

  return (
    <>
      <PageHeader
        title="Pick & Ship"
        description="Open orders - gegroepeerd op afleverdatum"
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {statCards.map((s) => (
          <div key={s.label} className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon size={16} className={s.color} />
              <span className="text-sm text-slate-500">{s.label}</span>
            </div>
            <p className="text-2xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => {
            const isActive = filter === t.key
            return (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors',
                  isActive
                    ? 'bg-terracotta-500 text-white font-medium'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                )}
              >
                {t.label}
                <span
                  className={cn(
                    'text-xs px-1.5 py-0.5 rounded-full',
                    isActive ? 'bg-white/20' : 'bg-slate-200'
                  )}
                >
                  {t.aantal}
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
            placeholder="Zoek op sticker, order, klant..."
            className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Pick & Ship laden...
        </div>
      ) : gefilterd.length === 0 ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Geen open orders
        </div>
      ) : filter !== 'alles' ? (
        <div className="space-y-3">
          {gefilterd.map((o) => (
            <OrderPickCard key={o.order_id} order={o} />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {BUCKET_VOLGORDE.map((bucket) => {
            const lijst = perBucket.get(bucket) ?? []
            if (lijst.length === 0) return null
            return (
              <section key={bucket}>
                <h3 className="text-sm font-semibold text-slate-700 mb-2 px-1">
                  {BUCKET_LABEL[bucket]}{' '}
                  <span className="text-slate-400 font-normal">({lijst.length})</span>
                </h3>
                <div className="space-y-3">
                  {lijst.map((o) => (
                    <OrderPickCard key={o.order_id} order={o} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
