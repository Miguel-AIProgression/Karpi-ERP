import { useMemo, useState } from 'react'
import { Globe, Search, Package, CalendarCheck, CalendarClock } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PickProblemenBanner } from '../components/pick-problemen-banner'
import { HstAandachtBanner } from '@/modules/logistiek'
import { PickDagOrdersSectie } from '../components/pick-dag-orders-sectie'
import { PickGeblokkeerdSectie } from '../components/pick-geblokkeerd-sectie'
import { PickWeekSectie } from '../components/pick-week-sectie'
import { usePickShipOrders, usePickShipStats } from '../hooks/use-pick-ship'
import {
  VervoerderFilterButton,
  VervoerderResolutieProvider,
  useEffectieveVervoerderVoorOrders,
  type VervoerderFilterValue,
} from '@/modules/logistiek'
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

  // Vervoerder-resolutie in ÉÉN batch-call (mig 401) i.p.v. N losse RPC's per
  // order-card. De `VervoerderResolutieProvider` rond de secties hieronder
  // hergebruikt dezelfde queryKey (React Query dedupliceert → 1 fetch) en seedt
  // de per-order caches zodat de inline-select/pill/knop in elke card de data
  // uit de cache lezen i.p.v. zelf te fetchen. Voedt hier de page-niveau maps:
  // het vervoerder-filter en de geblokkeerd/startbaar-split.
  // Eén globale batch-resolutie voor ALLE orders (niet alleen de actieve bucket).
  // Dezelfde queryKey als de VervoerderResolutieProvider → React Query
  // dedupliceert naar één fetch. Voordelen: (1) tab-tellingen kunnen meebewegen
  // met het vervoerder-filter, (2) kaartjes in andere tabs zijn al pre-seeded
  // als de gebruiker van tab wisselt.
  const allOrderIds = useMemo(
    () => Array.from(new Set(orders?.map((o) => o.order_id) ?? [])).sort((a, b) => a - b),
    [orders],
  )
  const { data: regelsPerOrder } = useEffectieveVervoerderVoorOrders(allOrderIds)

  const vervoerderMap = useMemo(() => {
    const m = new Map<number, ResolvedVervoerder>()
    gefilterd.forEach((o) => {
      const regels = regelsPerOrder?.get(o.order_id) ?? []
      const aggregaat = aggregeerVervoerderKeuzeVoorOrder(regels)
      m.set(o.order_id, {
        code: aggregaat.soort === 'uniform' ? aggregaat.code : null,
        afhalen: o.afhalen,
      })
    })
    return m
  }, [gefilterd, regelsPerOrder])

  // Niet-startbare orders ("Geen vervoerder mogelijk", zelfde predicaat als
  // StartPickrondesButton + de mig 373-guard): ≥1 regel bron='geen' op een
  // niet-afhaal-order. Deze sorteren ónder de startbare orders in elke sectie.
  const geblokkeerdeOrderIds = useMemo(() => {
    const s = new Set<number>()
    gefilterd.forEach((o) => {
      if (o.afhalen) return
      const regels = regelsPerOrder?.get(o.order_id)
      if (regels?.some((r) => r.bron === 'geen')) s.add(o.order_id)
    })
    return s
  }, [gefilterd, regelsPerOrder])

  // Gefilterde tellingen per bucket — zodat de weektabs meebewegen als een
  // vervoerder-filter actief is. null = geen filter → val terug op stats.
  const gefilterdeTellingenPerBucket = useMemo(() => {
    if (vervoerderFilter === 'all' || !orders) return null
    const m = new Map<BucketKey, number>()
    for (const o of orders) {
      const r = regelsPerOrder?.get(o.order_id)
      if (!r) continue
      const aggregaat = aggregeerVervoerderKeuzeVoorOrder(r)
      const code = aggregaat.soort === 'uniform' ? aggregaat.code : null
      let match: boolean
      if (vervoerderFilter === 'afhalen') match = o.afhalen
      else if (vervoerderFilter === 'geen') match = !o.afhalen && !code
      else match = !o.afhalen && code === vervoerderFilter
      if (!match) continue
      m.set(o.bucket, (m.get(o.bucket) ?? 0) + 1)
    }
    return m
  }, [orders, regelsPerOrder, vervoerderFilter])

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

  // ISO-datumstring van vandaag in lokale tijd (niet UTC) — veilig voor
  // verzendWeekVoor/pickWeekVoor die op 'YYYY-MM-DD' werken.
  const vandaagIso = useMemo(() => {
    const d = vandaagDate
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [vandaagDate])

  // Orders waarvan de Verzendset/print-knop geblokkeerd is om een ándere reden
  // dan "geen vervoerder" (die staan al in de aparte sectie onderaan): nog niet
  // pickbaar (`alle_regels_pickbaar=false`), onvolledig afleveradres (mig 395)
  // of ontbrekende prijs (mig 396) — zelfde per-order-condities die
  // StartPickrondesButton disabled maken. Orders met een lopende pickronde
  // tellen NIET als geblokkeerd: die zijn in uitvoering, geen probleem. Deze set
  // laat de niet-printbare orders ónderaan elke week-/dag-sectie zakken zodat
  // alles wat de magazijnier wél kan starten bovenaan staat (verzoek Miguel
  // 2026-06-16). Hergebruikt het bestaande `geblokkeerdeOrderIds`-sorteerpad in
  // clusterOrdersOpKlant.
  const nietPrintbaarIds = useMemo(() => {
    const s = new Set<number>()
    for (const o of startbareOrders) {
      if (o.actieve_pickronde) continue
      if (
        !o.alle_regels_pickbaar ||
        o.afl_adres_incompleet_sinds ||
        o.prijs_ontbreekt_sinds
      ) {
        s.add(o.order_id)
      }
    }
    return s
  }, [startbareOrders])

  // Groepeer binnen het actieve filter per verzendweek (gesorteerd op sleutel).
  // Voor wk_2..wk_5 hoort er normaal precies één verzendweek-groep te zijn.
  //
  // Voor wk_1 (huidige + achterstallige orders) worden ALLE sub-week-groepen
  // samengevoegd in ÉÉN sectie. Achterstallige orders (verlopen verzendweek)
  // moeten kunnen bundelen met huidige-week-orders naar hetzelfde adres — dat
  // kan alleen als ze in dezelfde PickWeekSectie zitten zodat clusterOrdersOpKlant
  // ze gezamenlijk groepeert. De SQL-view (mig 403) clampt de bundel-sleutel-week
  // al naar CURRENT_DATE, dus voorgestelde bundels overspannen weken.
  //
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
      // wk_1: alles in één gecombineerde groep; andere buckets: per verzendweek.
      const groepSleutel = filter === 'wk_1' ? '__wk1_gecombineerd__' : o.verzend_week_sleutel

      const bestaand = map.get(groepSleutel)
      if (bestaand) {
        bestaand.orders.push(o)
      } else {
        // wk_1 merged: gebruik vandaag als header-referentie ("Te picken in week
        // N · Verzendweek M" voor de actuele week). Status = 'deze_week' zodat
        // de sectiekop niet geheel rood kleurt terwijl er ook on-track orders in
        // zitten. Achterstallige orders zijn herkenbaar via hun eigen order-kaart.
        // Andere buckets: leid de header af van de eigenlijke afleverdatum.
        const datumIso = filter === 'wk_1' ? vandaagIso : o.afleverdatum
        const verzend = verzendWeekVoor(datumIso)
        const pick = pickWeekVoor(datumIso)
        const status: PickStatus = filter === 'wk_1' ? 'deze_week' : pickStatusVoor(o.afleverdatum, vandaagDate)
        map.set(groepSleutel, {
          sleutel: groepSleutel,
          orders: [o],
          verzendWeek: verzend?.week ?? null,
          pickWeek: pick?.week ?? null,
          status,
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.sleutel.localeCompare(b.sleutel))
  }, [weekOrders, filter, vandaagDate, vandaagIso])

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
    aantal: gefilterdeTellingenPerBucket?.get(t.key) ?? stats?.per_bucket[t.key] ?? 0,
    // Toon een dimme originele telling naast de gefilterde telling zodat de
    // gebruiker ziet hoeveel orders er in totaal in die week staan.
    aantalTotaal: gefilterdeTellingenPerBucket ? (stats?.per_bucket[t.key] ?? 0) : null,
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
            const isGefilterd = t.aantalTotaal !== null
            return (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                title={isGefilterd ? `${t.aantal} van ${t.aantalTotaal} orders voor geselecteerde vervoerder` : undefined}
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
                    'inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full',
                    isActive ? 'bg-white/20' : 'bg-slate-200'
                  )}
                >
                  {t.aantal}
                  {isGefilterd && (
                    <span className={cn('opacity-60', isActive ? '' : 'text-slate-400')}>
                      /{t.aantalTotaal}
                    </span>
                  )}
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
        // Provider deelt de batch-resolutie (mig 401) met alle cards hieronder:
        // de inline-select, pill en Verzendset-knop lezen de geseede cache i.p.v.
        // elk een eigen RPC af te vuren. Zelfde queryKey als de page-niveau hook
        // hierboven (allOrderIds) → één gedeelde fetch; cards in andere tabs zijn
        // al pre-seeded als de gebruiker van tab wisselt.
        <VervoerderResolutieProvider orderIds={allOrderIds}>
          <div className="space-y-6">
            {dagOrders.length > 0 && (
              <PickDagOrdersSectie
                orders={dagOrders}
                groepeerOpLand={groepeerOpLand}
                geblokkeerdeOrderIds={nietPrintbaarIds}
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
                geblokkeerdeOrderIds={nietPrintbaarIds}
                // wk_1 is één gecombineerde sectie: geef ALLE voorgestelde
                // bundels mee. Na mig 403 zijn alle achterstallige bundels
                // geclampt naar de huidige week en zitten in de view — de
                // PickWeekSectie matcht op order_id, dus bundels van andere
                // tabs beïnvloeden de clustering niet.
                voorgesteldeBundels={
                  filter === 'wk_1'
                    ? voorgesteldeBundels
                    : bundelsPerWeek.get(groep.sleutel) ?? []
                }
              />
            ))}
            <PickGeblokkeerdSectie
              orders={geblokkeerdeOrders}
              groepeerOpLand={groepeerOpLand}
            />
          </div>
        </VervoerderResolutieProvider>
      )}
    </>
  )
}
