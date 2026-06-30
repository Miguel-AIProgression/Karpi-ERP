import { useMemo, useState } from 'react'
import { Globe, Search, Package, CalendarCheck, CalendarClock, Printer, CheckCheck } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PickProblemenBanner } from '../components/pick-problemen-banner'
import { HstAandachtBanner } from '@/modules/logistiek'
import { PickDagOrdersSectie } from '../components/pick-dag-orders-sectie'
import { PickGeblokkeerdSectie } from '../components/pick-geblokkeerd-sectie'
import { PickWeekSectie } from '../components/pick-week-sectie'
import { PickSelectieBalk } from '../components/pick-selectie-balk'
import { usePickSelectieState, type PickSelectieModus } from '../context/pick-selectie-context'
import { PickSelectieProvider } from '../context/pick-selectie-provider'
import { usePickShipOrders, usePickShipStats } from '../hooks/use-pick-ship'
import {
  VervoerderFilterButton,
  VervoerderResolutieProvider,
  useEffectieveVervoerderVoorOrders,
  bepaalStartbaarheid,
  heeftGeenVervoerder,
  type StartStatus,
  type VervoerderFilterValue,
} from '@/modules/logistiek'
import { aggregeerVervoerderKeuzeVoorOrder } from '@/modules/logistiek/queries/vervoerder-keuze'
import { useVoorgesteldeBundels } from '@/modules/logistiek/queries/voorgestelde-bundels'
import type { ResolvedVervoerder } from '@/modules/logistiek/lib/resolved-vervoerder'
import { cn } from '@/lib/utils/cn'
import { zendingenVoorAfronden } from '../lib/afrond-selectie'
import { genereerWeekTabs } from '../lib/buckets'
import { type BucketKey, type PickShipOrder } from '../lib/types'
import {
  isoWeek,
  pickStatusVoor,
  pickWeekVoor,
  verzendWeekVoor,
  type PickStatus,
} from '@/lib/orders/verzendweek'
import { useAuth } from '@/hooks/use-auth'

export function MagazijnOverviewPage() {
  const [filter, setFilter] = useState<BucketKey>('wk_1')
  const [search, setSearch] = useState('')
  const [groepeerOpLand, setGroepeerOpLand] = useState(false)
  const [vervoerderFilter, setVervoerderFilter] = useState<VervoerderFilterValue>('all')
  // Modus (besluit 17-06-2026): 'starten' = orders selecteren om te picken &
  // printen (default); 'afronden' = al-gestarte pickrondes selecteren en in bulk
  // op compleet zetten (→ Verzonden), zonder printen.
  const [modus, setModus] = useState<PickSelectieModus>('starten')
  // Externe vertegenwoordiger (mig 489): read-only — geen multi-select start/
  // afrond-affordances (checkboxes + actiebalk).
  const { isExternRep } = useAuth()

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

  // Startbaarheid als single source (ADR-0037): één canonieke status per order,
  // bepaald uit de view-pickbaarheid (`alle_regels_pickbaar`) + de intake-gates +
  // de al-aanwezige vervoerder-batch (`regelsPerOrder` — géén extra fetch). Alle
  // afgeleide sets hieronder (geblokkeerd-split, sink-sortering, multi-select)
  // lezen deze map i.p.v. het predikaat opnieuw inline af te leiden.
  const startbaarheidStatus = useMemo(() => {
    const m = new Map<number, StartStatus>()
    for (const o of gefilterd) {
      m.set(
        o.order_id,
        bepaalStartbaarheid({
          order_id: o.order_id,
          afhalen: o.afhalen,
          alle_regels_pickbaar: o.alle_regels_pickbaar,
          heeft_gepland_zending: o.heeft_gepland_zending,
          afl_adres_incompleet_sinds: o.afl_adres_incompleet_sinds,
          prijs_ontbreekt_sinds: o.prijs_ontbreekt_sinds,
          in_pickronde: o.actieve_pickronde !== null,
          geen_vervoerder: heeftGeenVervoerder(o.afhalen, regelsPerOrder?.get(o.order_id)),
        }).status,
      )
    }
    return m
  }, [gefilterd, regelsPerOrder])

  // Orders waarvan de vervoerder de énige blocker is ("Geen vervoerder mogelijk",
  // server-side gespiegeld in start_pickronden, mig 373). Splitsen naar de eigen
  // sectie onderaan. Orders die óók niet-pickbaar of adres-/prijs-geblokkeerd zijn
  // vallen hier bewust buiten (ADR-0037) — die tonen onder hun primaire reden in
  // de week-/dag-sectie.
  const geblokkeerdeOrderIds = useMemo(() => {
    const s = new Set<number>()
    for (const [id, status] of startbaarheidStatus) {
      if (status === 'geen_vervoerder') s.add(id)
    }
    return s
  }, [startbaarheidStatus])

  // Gefilterde tellingen per bucket — zodat de weektabs meebewegen als een
  // vervoerder-filter actief is. null = geen filter → val terug op stats.
  const gefilterdeTellingenPerBucket = useMemo(() => {
    // Live tellingen per bucket, modus- én vervoerder-bewust zodat de weektab-
    // badges exact de getoonde lijst weerspiegelen:
    //  - 'afronden' telt alleen orders MÉT een lopende pickronde,
    //  - 'starten' sluit lopende pickrondes juist UIT (daar valt niets meer te
    //    starten — die horen in de Afronden-modus),
    //  - een actief vervoerder-filter vernauwt verder.
    // `orders` is al door de Pick & Ship-gate (pick_ship_zichtbaar + dag-horizon)
    // gegaan, dus dit telt de daadwerkelijk zichtbare orders. null = nog geen
    // data → val terug op de server-stats.
    if (!orders) return null
    const orders_m = new Map<BucketKey, number>()
    const stuks_m = new Map<BucketKey, number>()
    for (const o of orders) {
      if (modus === 'afronden' ? !o.actieve_pickronde : o.actieve_pickronde) continue
      if (vervoerderFilter !== 'all') {
        const r = regelsPerOrder?.get(o.order_id)
        if (!r) continue
        const aggregaat = aggregeerVervoerderKeuzeVoorOrder(r)
        const code = aggregaat.soort === 'uniform' ? aggregaat.code : null
        let match: boolean
        if (vervoerderFilter === 'afhalen') match = o.afhalen
        else if (vervoerderFilter === 'geen') match = !o.afhalen && !code
        else match = !o.afhalen && code === vervoerderFilter
        if (!match) continue
      }
      orders_m.set(o.bucket, (orders_m.get(o.bucket) ?? 0) + 1)
      const stuks = o.regels.reduce((s, r) => s + (r.orderaantal ?? 0), 0)
      stuks_m.set(o.bucket, (stuks_m.get(o.bucket) ?? 0) + stuks)
    }
    return { orders: orders_m, stuks: stuks_m }
  }, [orders, regelsPerOrder, vervoerderFilter, modus])

  const naVervoerderFilter = useMemo(() => {
    // Strikte scheiding tussen de twee modi (verzoek Miguel 18-06):
    //  - 'afronden' toont uitsluitend orders MÉT een lopende pickronde (alleen
    //    daar valt iets af te ronden);
    //  - 'starten' toont uitsluitend orders ZÓNDER lopende pickronde (de zwarte
    //    Verzendset-knop) — een al-gestarte order hoort in de Afronden-modus en
    //    mag de te-starten-lijst niet vervuilen.
    const basis = gefilterd.filter((o) =>
      modus === 'afronden' ? o.actieve_pickronde : !o.actieve_pickronde,
    )
    if (vervoerderFilter === 'all') return basis
    return basis.filter((o) => {
      const r = vervoerderMap.get(o.order_id)
      if (!r) return false
      if (vervoerderFilter === 'afhalen') return r.afhalen
      if (vervoerderFilter === 'geen') return !r.afhalen && !r.code
      return !r.afhalen && r.code === vervoerderFilter
    })
  }, [gefilterd, vervoerderFilter, vervoerderMap, modus])

  // Voorgestelde-bundels (mig 229/535): pure SQL-view per (debiteur × adres ×
  // vervoerder) — week is geen bundel-dimensie meer (mig 535). Eén fetch over
  // alle orders — staleTime via hook.
  const { data: voorgesteldeBundels = [] } = useVoorgesteldeBundels()

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
  // pickbaar, onvolledig afleveradres (mig 395) of ontbrekende prijs (mig 396) —
  // de statussen `niet_pickbaar`/`afl_adres`/`prijs` uit de startbaarheid-map
  // (ADR-0037). Orders met een lopende pickronde (status `in_pickronde`) vallen
  // hier per definitie buiten — die zijn in uitvoering, geen probleem. Deze set
  // laat de niet-printbare orders ónderaan elke week-/dag-sectie zakken zodat
  // alles wat de magazijnier wél kan starten bovenaan staat (verzoek Miguel
  // 2026-06-16). Hergebruikt het bestaande `geblokkeerdeOrderIds`-sorteerpad in
  // clusterOrdersOpKlant.
  const nietPrintbaarIds = useMemo(() => {
    const s = new Set<number>()
    for (const o of startbareOrders) {
      const status = startbaarheidStatus.get(o.order_id)
      if (status === 'niet_pickbaar' || status === 'afl_adres' || status === 'prijs') {
        s.add(o.order_id)
      }
    }
    return s
  }, [startbareOrders, startbaarheidStatus])

  // Multi-select (besluit 2026-06-17), twee modi:
  //  - 'starten': orders aanvinken → in één keer starten & printen met optionele
  //    picker. Selecteerbaar = wat de pick-start-knop ook zou accepteren:
  //    pickbaar, niet geblokkeerd (geen vervoerder valt al uit `startbareOrders`),
  //    geen onvolledig adres/prijs (`nietPrintbaarIds`), en niet al in een lopende
  //    pickronde.
  //  - 'afronden': al-gestarte pickrondes aanvinken → in bulk op compleet zetten.
  //    Selecteerbaar = orders MÉT lopende pickronde (de gate-checks zijn dan al
  //    gepasseerd bij het starten).
  // De selectie wist bij tab-/vervoerderfilter-/modus-wissel.
  const selectableIds = useMemo(() => {
    const s = new Set<number>()
    // Read-only vertegenwoordiger: niets selecteerbaar → geen checkboxes/balk.
    if (isExternRep) return s
    for (const o of startbareOrders) {
      const status = startbaarheidStatus.get(o.order_id)
      if (modus === 'afronden') {
        if (status === 'in_pickronde') s.add(o.order_id)
      } else if (status === 'startbaar') {
        s.add(o.order_id)
      }
    }
    return s
  }, [isExternRep, modus, startbareOrders, startbaarheidStatus])

  const selectie = usePickSelectieState(
    `${filter}|${vervoerderFilter}|${modus}`,
    selectableIds,
    modus,
  )

  const geselecteerdeOrders = useMemo(
    () => startbareOrders.filter((o) => selectie.selectedIds.has(o.order_id)),
    [startbareOrders, selectie.selectedIds],
  )

  // Afrond-modus werkt op zending-niveau: een bundel-zending hoort bij meerdere
  // geselecteerde orders maar moet één keer voltooid worden. Dedupliceer de
  // geselecteerde orders naar hun unieke actieve-pickronde-zending.
  const geselecteerdeZendingen = useMemo(
    () => zendingenVoorAfronden(geselecteerdeOrders),
    [geselecteerdeOrders],
  )

  // Transparantie: hoeveel niet-geselecteerde orders door de auto-4D-bundeling
  // van `start_pickronden` tóch meekomen (bundel-partners in dezelfde
  // voorgestelde bundel). Puur informatief in de actiebalk.
  const aantalBundelPartners = useMemo(() => {
    if (selectie.selectedIds.size === 0) return 0
    const partners = new Set<number>()
    for (const b of voorgesteldeBundels) {
      if (b.order_ids.some((id) => selectie.selectedIds.has(id))) {
        for (const id of b.order_ids) {
          if (!selectie.selectedIds.has(id)) partners.add(id)
        }
      }
    }
    return partners.size
  }, [voorgesteldeBundels, selectie.selectedIds])

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
      sub: stats ? `${stats.totaal_stuks} stuks` : null,
      icon: Package,
      color: 'text-teal-600',
    },
    {
      label: 'Te picken deze week',
      value: stats?.per_bucket.wk_1 ?? 0,
      sub: stats ? `${stats.per_bucket_stuks.wk_1} stuks` : null,
      icon: CalendarCheck,
      color: 'text-rose-600',
    },
    {
      label: 'Later',
      value: stats?.per_bucket.later ?? 0,
      sub: stats ? `${stats.per_bucket_stuks.later} stuks` : null,
      icon: CalendarClock,
      color: 'text-amber-600',
    },
  ]

  // De "/totaal"-suffix verschijnt alleen wanneer de telling een echte deel-
  // verzameling is: bij een actief vervoerder-filter of in de Afronden-modus
  // (lopende pickrondes ⊂ alle open orders). In de gewone Starten-modus zonder
  // filter is de telling de volledige te-starten-lijst → geen suffix (gedragsbehoud).
  const toonTellingSuffix = vervoerderFilter !== 'all' || modus === 'afronden'
  const tabs = weekTabs.map((t) => ({
    key: t.key,
    label: t.label,
    // Bij een live tellingsmap is een ontbrekende bucket écht 0 — niet "val terug
    // op stats". Die fallback toonde voorheen onterecht het volledige weektotaal
    // voor een lege Afronden-bucket (bv. "74/74" i.p.v. "0/74").
    aantal: gefilterdeTellingenPerBucket
      ? gefilterdeTellingenPerBucket.orders.get(t.key) ?? 0
      : stats?.per_bucket[t.key] ?? 0,
    stuks: gefilterdeTellingenPerBucket
      ? gefilterdeTellingenPerBucket.stuks.get(t.key) ?? 0
      : stats?.per_bucket_stuks?.[t.key] ?? 0,
    aantalTotaal: toonTellingSuffix ? (stats?.per_bucket[t.key] ?? 0) : null,
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
            <p className="text-2xl font-semibold">{s.value} <span className="text-base font-normal text-slate-400">orders</span></p>
            {s.sub && <p className="text-sm text-slate-500 mt-0.5">{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* Modus-switch: picken starten vs. gepickte rondes afronden (besluit 17-06-2026). */}
      <div className="mb-4 inline-flex rounded-[var(--radius)] border border-slate-200 bg-slate-100 p-1">
        {([
          { key: 'starten', label: 'Picken starten', icon: Printer },
          { key: 'afronden', label: 'Afronden', icon: CheckCheck },
        ] as const).map((m) => {
          const isActive = modus === m.key
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setModus(m.key)}
              aria-pressed={isActive}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3.5 py-1.5 text-sm font-medium transition-colors',
                isActive
                  ? m.key === 'afronden'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-terracotta-500 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900',
              )}
            >
              <m.icon size={15} />
              {m.label}
            </button>
          )
        })}
      </div>
      {modus === 'afronden' && (
        <p className="-mt-2 mb-4 text-sm text-slate-500">
          Vink de pickrondes aan die fysiek gepickt zijn en zet ze in één keer op compleet — er worden geen labels geprint.
        </p>
      )}

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
                  <span className={cn('opacity-60', isActive ? '' : 'text-slate-400')}>
                    {' · '}{t.stuks} st
                  </span>
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
          {modus === 'afronden' ? 'Geen lopende pickrondes om af te ronden' : 'Geen open orders'}
        </div>
      ) : (
        // Provider deelt de batch-resolutie (mig 401) met alle cards hieronder:
        // de inline-select, pill en Verzendset-knop lezen de geseede cache i.p.v.
        // elk een eigen RPC af te vuren. Zelfde queryKey als de page-niveau hook
        // hierboven (allOrderIds) → één gedeelde fetch; cards in andere tabs zijn
        // al pre-seeded als de gebruiker van tab wisselt.
        <VervoerderResolutieProvider orderIds={allOrderIds}>
          <PickSelectieProvider value={selectie}>
            {/* key={modus} forceert een verse mount van de lijst bij het wisselen
                tussen Starten en Afronden. De data (perWeek) is per render al
                correct gefilterd op modus, maar de secties + klant-clusters dragen
                stabiele keys ('__wk1_gecombineerd__' resp. 'none-<debiteur_nr>'),
                waardoor React bij een modus-wissel de oude card-DOM hergebruikte
                i.p.v. te verversen — de lijst bleef dan één render achter (stale)
                tot een volgende interactie. Remounten op modus omzeilt dat. */}
            <div key={modus} className="space-y-6">
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
                  // Mig 535: bundels filteren op order-id-membership i.p.v.
                  // op jaar_week. Week is geen bundel-dimensie meer — een bundel
                  // kan orders uit meerdere weken bevatten. De PickWeekSectie
                  // matcht sowieso op order_id (sleutelByOrderId-map), dus
                  // bundels van andere secties beïnvloeden de clustering niet.
                  voorgesteldeBundels={voorgesteldeBundels.filter((b) =>
                    b.order_ids.some((oid) =>
                      groep.orders.some((o) => o.order_id === oid),
                    )
                  )}
                />
              ))}
              <PickGeblokkeerdSectie
                orders={geblokkeerdeOrders}
                groepeerOpLand={groepeerOpLand}
              />
            </div>
          </PickSelectieProvider>
        </VervoerderResolutieProvider>
      )}

      {!isExternRep && (
        <PickSelectieBalk
          modus={modus}
          geselecteerdeOrders={geselecteerdeOrders}
          geselecteerdeZendingen={geselecteerdeZendingen}
          aantalBundelPartners={aantalBundelPartners}
          onClear={selectie.clear}
        />
      )}
    </>
  )
}
