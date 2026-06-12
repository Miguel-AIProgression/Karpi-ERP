import { useMemo, useState } from 'react'
import { Globe, Search, Package, CalendarCheck, CalendarClock } from 'lucide-react'
import { useQueries } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/page-header'
import { PickProblemenBanner } from '../components/pick-problemen-banner'
import { HstAandachtBanner } from '@/modules/logistiek'
import { PickDagOrdersSectie } from '../components/pick-dag-orders-sectie'
import { PickGeblokkeerdSectie } from '../components/pick-geblokkeerd-sectie'
import { PickWeekSectie } from '../components/pick-week-sectie'
import { usePickShipOrders, usePickShipStats } from '../hooks/use-pick-ship'
import {
  VervoerderFilterButton,
  type VervoerderFilterValue,
} from '@/modules/logistiek'
import { fetchEffectieveVervoerderPerOrderregel } from '@/modules/logistiek/queries/orderregel-vervoerder'
import { aggregeerVervoerderKeuzeVoorOrder } from '@/modules/logistiek/queries/vervoerder-keuze'
import { useVoorgesteldeBundels } from '@/modules/logistiek/queries/voorgestelde-bundels'
import type { ResolvedVervoerder } from '@/modules/logistiek/lib/resolved-vervoerder'
import { cn } from '@/lib/utils/cn'
import { genereerWeekTabs } from '../lib/buckets'
import { type BucketKey, type PickShipOrder } from '../lib/types'
import {
  isoWeek,
  pickStatusVoor,
  pickWeekVoor,
  verzendWeekVoor,
  type PickStatus,
} from '@/lib/orders/verzendweek'

const STALE_30_SEC = 30_000

export function MagazijnOverviewPage() {
  const [filter, setFilter] = useState<BucketKey>('wk_1')
  const [search, setSearch] = useState('')
  const [groepeerOpLand, setGroepeerOpLand] = useState(false)
  const [vervoerderFilter, setVervoerderFilter] = useState<VervoerderFilterValue>('all')

  const { data: stats } = usePickShipStats()
  const { data: orders, isLoading } = usePickShipOrders({
    search: search || undefined,
  })

  // Eénmalig vandaag-anker: gebruikt voor de actuele-week-chip én voor de
  // achterstallig-bepaling per groep, zodat ze altijd consistent zijn.
  const vandaagDate = useMemo(() => new Date(), [])
  const huidigeWeek = useMemo(() => isoWeek(vandaagDate), [vandaagDate])

  const weekTabs = useMemo(() => genereerWeekTabs(vandaagDate), [vandaagDate])

  const gefilterd = useMemo(() => {
    if (!orders) return []
    return orders.filter((o) => o.bucket === filter)
  }, [orders, filter])

  // Vervoerder-filter: resolutie via per-orderregel-evaluator (ADR-0008).
  // Cache wordt gedeeld met de inline-select in elke pick-card via dezelfde
  // queryKeys ['logistiek', 'orderregel-vervoerder', orderId] (ADR-0002).
  const perOrderQueries = useQueries({
    queries: gefilterd.map((o) => ({
      queryKey: ['logistiek', 'orderregel-vervoerder', o.order_id],
      queryFn: () => fetchEffectieveVervoerderPerOrderregel(o.order_id),
      staleTime: STALE_30_SEC,
    })),
  })
  const vervoerderMap = useMemo(() => {
    const m = new Map<number, ResolvedVervoerder>()
    gefilterd.forEach((o, i) => {
      const q = perOrderQueries[i]
      const regels = q?.data ?? []
      const aggregaat = aggregeerVervoerderKeuzeVoorOrder(regels)
      m.set(o.order_id, {
        code: aggregaat.soort === 'uniform' ? aggregaat.code : null,
        afhalen: o.afhalen,
      })
    })
    return m
  }, [gefilterd, perOrderQueries])

  // Niet-startbare orders ("Geen vervoerder mogelijk", zelfde predicaat als
  // StartPickrondesButton + de mig 373-guard): ≥1 regel bron='geen' op een
  // niet-afhaal-order. Deze sorteren ónder de startbare orders in elke sectie.
  const geblokkeerdeOrderIds = useMemo(() => {
    const s = new Set<number>()
    gefilterd.forEach((o, i) => {
      if (o.afhalen) return
      const regels = perOrderQueries[i]?.data
      if (regels?.some((r) => r.bron === 'geen')) s.add(o.order_id)
    })
    return s
  }, [gefilterd, perOrderQueries])

  const naVervoerderFilter = useMemo(() => {
    if (vervoerderFilter === 'all') return gefilterd
    return gefilterd.filter((o) => {
      const r = vervoerderMap.get(o.order_id)
      if (!r) return false
      if (vervoerderFilter === 'afhalen') return r.afhalen
      if (vervoerderFilter === 'geen') return !r.afhalen && !r.code
      return !r.afhalen && r.code === vervoerderFilter
    })
  }, [gefilterd, vervoerderFilter, vervoerderMap])

  // Voorgestelde-bundels (mig 229): pure SQL-view die per (debiteur × adres ×
  // vervoerder × verzendweek) de open-orders aggregeert met drempel-toets en
  // besparing-indicator. Eén fetch over alle weken — staleTime via hook.
  const { data: voorgesteldeBundels = [] } = useVoorgesteldeBundels()
  const bundelsPerWeek = useMemo(() => {
    const m = new Map<string, typeof voorgesteldeBundels>()
    for (const b of voorgesteldeBundels) {
      const lijst = m.get(b.jaar_week) ?? []
      lijst.push(b)
      m.set(b.jaar_week, lijst)
    }
    return m
  }, [voorgesteldeBundels])

  // Geblokkeerde orders ("Geen vervoerder mogelijk") gaan niet de week-secties
  // in maar naar een eigen sectie ónder alles (verzoek Miguel 2026-06-12):
  // hun oude verzendweken zetten ze anders als "Achterstallig"-koppen bovenaan
  // de tab, terwijl de magazijnier er niets mee kan tot de vervoerder-cutover.
  const geblokkeerdeOrders = useMemo(
    () => naVervoerderFilter.filter((o) => geblokkeerdeOrderIds.has(o.order_id)),
    [naVervoerderFilter, geblokkeerdeOrderIds],
  )
  const startbareOrders = useMemo(
    () => naVervoerderFilter.filter((o) => !geblokkeerdeOrderIds.has(o.order_id)),
    [naVervoerderFilter, geblokkeerdeOrderIds],
  )

  // Dag-orders (`lever_type='datum'`, ADR 0014) krijgen een eigen sectie
  // bovenaan: ze hebben een specifieke afleverdag-belofte en moeten niet
  // tussen de week-buckets verdwijnen. Week-orders blijven in de bestaande
  // verzendweek-groepen.
  const dagOrders = useMemo(
    () => startbareOrders.filter((o) => o.lever_type === 'datum'),
    [startbareOrders],
  )
  const weekOrders = useMemo(
    () => startbareOrders.filter((o) => o.lever_type !== 'datum'),
    [startbareOrders],
  )

  // Groepeer binnen het actieve filter per verzendweek (gesorteerd op sleutel).
  // Voor wk_1 kunnen er meerdere groepen zijn (achterstallig + huidige + +1);
  // voor wk_2..wk_5 hoort er normaal precies één verzendweek-groep te zijn.
  // Alleen week-orders — dag-orders zitten in de aparte top-sectie hierboven.
  const perWeek = useMemo(() => {
    type Groep = {
      sleutel: string
      orders: PickShipOrder[]
      verzendWeek: number | null
      pickWeek: number | null
      status: PickStatus
    }
    const map = new Map<string, Groep>()
    for (const o of weekOrders) {
      const bestaand = map.get(o.verzend_week_sleutel)
      if (bestaand) {
        bestaand.orders.push(o)
      } else {
        const verzend = verzendWeekVoor(o.afleverdatum)
        const pick = pickWeekVoor(o.afleverdatum)
        map.set(o.verzend_week_sleutel, {
          sleutel: o.verzend_week_sleutel,
          orders: [o],
          verzendWeek: verzend?.week ?? null,
          pickWeek: pick?.week ?? null,
          status: pickStatusVoor(o.afleverdatum, vandaagDate),
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.sleutel.localeCompare(b.sleutel))
  }, [weekOrders, vandaagDate])

  const statCards = [
    {
      label: 'Open orders',
      value: stats?.totaal_orders ?? 0,
      icon: Package,
      color: 'text-teal-600',
    },
    {
      label: 'Te picken deze week',
      value: stats?.per_bucket.wk_1 ?? 0,
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

  const tabs = weekTabs.map((t) => ({
    key: t.key,
    label: t.label,
    aantal: stats?.per_bucket[t.key] ?? 0,
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
      <HstAandachtBanner />

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
        <button
          type="button"
          onClick={() => setGroepeerOpLand((v) => !v)}
          aria-pressed={groepeerOpLand}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors',
            groepeerOpLand
              ? 'bg-teal-100 text-teal-800 ring-1 ring-teal-300'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
          )}
        >
          <Globe size={14} />
          Groeperen op land
        </button>
        <VervoerderFilterButton
          resolvedPerOrder={vervoerderMap}
          totaalOrders={gefilterd.length}
          value={vervoerderFilter}
          onChange={setVervoerderFilter}
        />
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
      ) : dagOrders.length === 0 && perWeek.length === 0 && geblokkeerdeOrders.length === 0 ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Geen open orders
        </div>
      ) : (
        <div className="space-y-6">
          {dagOrders.length > 0 && (
            <PickDagOrdersSectie
              orders={dagOrders}
              groepeerOpLand={groepeerOpLand}
              voorgesteldeBundels={voorgesteldeBundels.filter((b) =>
                b.order_ids.some((oid) =>
                  dagOrders.some((o) => o.order_id === oid),
                ),
              )}
            />
          )}
          {perWeek.map((groep) => (
            <PickWeekSectie
              key={groep.sleutel}
              orders={groep.orders}
              pickWeek={groep.pickWeek}
              verzendWeek={groep.verzendWeek}
              status={groep.status}
              groepeerOpLand={groepeerOpLand}
              voorgesteldeBundels={bundelsPerWeek.get(groep.sleutel) ?? []}
            />
          ))}
          <PickGeblokkeerdSectie
            orders={geblokkeerdeOrders}
            groepeerOpLand={groepeerOpLand}
          />
        </div>
      )}
    </>
  )
}
