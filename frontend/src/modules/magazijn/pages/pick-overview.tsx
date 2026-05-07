import { useMemo, useState } from 'react'
import { Search, Package, CalendarCheck, CalendarClock } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { OrderPickCard } from '../components/order-pick-card'
import { PickProblemenBanner } from '../components/pick-problemen-banner'
import { usePickShipOrders, usePickShipStats } from '../hooks/use-pick-ship'
import { cn } from '@/lib/utils/cn'
import { BUCKET_LABEL, BUCKET_VOLGORDE, type BucketKey, type PickShipOrder } from '../lib/types'
import { isoWeek, pickStatusVoor, verzendWeekVoor, type PickStatus } from '@/lib/orders/verzendweek'

export function MagazijnOverviewPage() {
  const [filter, setFilter] = useState<BucketKey>('deze_week')
  const [search, setSearch] = useState('')

  const { data: stats } = usePickShipStats()
  const { data: orders, isLoading } = usePickShipOrders({
    search: search || undefined,
  })

  // Eénmalig vandaag-anker: gebruikt voor de actuele-week-chip én voor de
  // achterstallig-bepaling per groep, zodat ze altijd consistent zijn.
  const vandaagDate = useMemo(() => new Date(), [])
  const huidigeWeek = useMemo(() => isoWeek(vandaagDate), [vandaagDate])

  const gefilterd = useMemo(() => {
    if (!orders) return []
    return orders.filter((o) => o.bucket === filter)
  }, [orders, filter])

  // Groepeer binnen het actieve filter per verzendweek (gesorteerd op sleutel).
  // Per groep berekenen we direct de pick-status zodat de section header weet
  // of het achterstallig (rose) of on-track (slate) gerenderd moet worden.
  const perWeek = useMemo(() => {
    type Groep = {
      sleutel: string
      orders: PickShipOrder[]
      verzendWeek: number | null
      status: PickStatus
    }
    const map = new Map<string, Groep>()
    for (const o of gefilterd) {
      const bestaand = map.get(o.verzend_week_sleutel)
      if (bestaand) {
        bestaand.orders.push(o)
      } else {
        const verzend = verzendWeekVoor(o.afleverdatum)
        map.set(o.verzend_week_sleutel, {
          sleutel: o.verzend_week_sleutel,
          orders: [o],
          verzendWeek: verzend?.week ?? null,
          status: pickStatusVoor(o.afleverdatum, vandaagDate),
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.sleutel.localeCompare(b.sleutel))
  }, [gefilterd, vandaagDate])

  const statCards = [
    {
      label: 'Open orders',
      value: stats?.totaal_orders ?? 0,
      icon: Package,
      color: 'text-teal-600',
    },
    {
      label: 'Te picken deze week',
      value: stats?.per_bucket.deze_week ?? 0,
      icon: CalendarCheck,
      color: 'text-rose-600',
    },
    {
      label: 'Later',
      value: stats?.per_bucket.later ?? 0,
      icon: CalendarClock,
      color: 'text-amber-600',
    },
  ]

  const tabs: { key: BucketKey; label: string; aantal: number }[] = BUCKET_VOLGORDE.map((k) => ({
    key: k,
    label: BUCKET_LABEL[k],
    aantal: stats?.per_bucket[k] ?? 0,
  }))

  return (
    <>
      <PageHeader
        title="Pick & Ship"
        description="Open orders gegroepeerd op verzendweek — picken altijd in de week ervóór"
        actions={
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-slate-500">Vandaag</div>
            <div className="text-lg font-semibold text-slate-900 leading-tight">
              Wk {huidigeWeek.week} · {huidigeWeek.jaar}
            </div>
          </div>
        }
      />

      <PickProblemenBanner />

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
      ) : perWeek.length === 0 ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Geen open orders
        </div>
      ) : (
        <div className="space-y-6">
          {perWeek.map((groep) => {
            const achterstallig = groep.status === 'achterstallig'
            return (
              <section key={groep.sleutel}>
                <h3 className="flex flex-wrap items-center gap-2 mb-2 px-1 text-sm font-semibold">
                  <span className={achterstallig ? 'text-rose-700' : 'text-slate-700'}>
                    Te picken deze week
                  </span>
                  {groep.verzendWeek !== null && (
                    <span
                      className={cn(
                        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                        achterstallig
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-teal-50 text-teal-700',
                      )}
                    >
                      Verzendweek {groep.verzendWeek}
                    </span>
                  )}
                  {achterstallig && (
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-500 text-white"
                      title="Pick-week ligt al in het verleden — had vorige week of eerder gepickt moeten worden"
                    >
                      Achterstallig
                    </span>
                  )}
                  <span className="text-slate-400 font-normal">({groep.orders.length})</span>
                </h3>
                <div className="space-y-3">
                  {groep.orders.map((o) => (
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
