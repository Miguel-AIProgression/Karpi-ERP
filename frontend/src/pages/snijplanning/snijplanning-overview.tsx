import { useState, useMemo } from 'react'
import { Search, Scissors, Calendar, CheckCircle2, Clock } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { GroepAccordion } from '@/components/snijplanning/groep-accordion'
import { cn } from '@/lib/utils/cn'
import { useSnijplanningGroepen, useSnijplanningStatusCounts, useProductieDashboard } from '@/hooks/use-snijplanning'
import { WeekFilter, berekenTotDatum } from '@/components/snijplanning/week-filter'

const SNIJPLAN_STATUSES = ['Alle', 'Wacht', 'Gepland', 'In productie', 'Gesneden', 'Gereed']

export function SnijplanningOverviewPage() {
  const [status, setStatus] = useState('Alle')
  const [search, setSearch] = useState('')
  const [wekenVooruit, setWekenVooruit] = useState<number | null>(null)
  const totDatum = berekenTotDatum(wekenVooruit)

  const { data: groepen, isLoading } = useSnijplanningGroepen(search || undefined, totDatum)
  const { data: statusCounts } = useSnijplanningStatusCounts(totDatum)
  const { data: dashboard } = useProductieDashboard()

  // Client-side filtering op basis van per-status counts
  const filteredGroepen = useMemo(() => {
    if (!groepen || status === 'Alle') return groepen ?? []
    return groepen.filter((g) => {
      switch (status) {
        case 'Wacht': return (g.totaal_wacht ?? 0) > 0
        case 'Gepland': return (g.totaal_gepland ?? 0) > 0
        case 'In productie': return (g.totaal_in_productie ?? 0) > 0
        case 'Gesneden': return (g.totaal_status_gesneden ?? 0) > 0
        case 'Gereed': return (g.totaal_gereed ?? 0) > 0
        default: return true
      }
    })
  }, [groepen, status])

  const countMap = new Map((statusCounts ?? []).map((c) => [c.status, c.aantal]))
  const allCount = (statusCounts ?? []).reduce((sum, c) => sum + c.aantal, 0)

  const stats = [
    { label: 'Totaal te snijden', value: dashboard?.snijplannen_wacht ?? 0, icon: Scissors, color: 'text-slate-700' },
    { label: 'Gepland', value: dashboard?.snijplannen_gepland ?? 0, icon: Calendar, color: 'text-blue-600' },
    { label: 'In productie', value: dashboard?.snijplannen_in_productie ?? 0, icon: Clock, color: 'text-indigo-600' },
    { label: 'Gesneden', value: dashboard?.snijplannen_gesneden ?? 0, icon: CheckCircle2, color: 'text-emerald-600' },
  ]

  return (
    <>
      <PageHeader
        title="Snijplanning"
        description={`${filteredGroepen.length ?? 0} kwaliteit/kleur groepen — ${allCount} snijplannen`}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon size={16} className={s.color} />
              <span className="text-sm text-slate-500">{s.label}</span>
            </div>
            <p className="text-2xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek op kwaliteit, kleur..."
            className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>
      </div>

      {/* Week filter */}
      <div className="mb-4">
        <WeekFilter geselecteerd={wekenVooruit} onChange={setWekenVooruit} />
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 overflow-x-auto pb-2 mb-4">
        {SNIJPLAN_STATUSES.map((s) => {
          const count = s === 'Alle' ? allCount : (countMap.get(s) ?? 0)
          const isActive = status === s
          return (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors',
                isActive
                  ? 'bg-terracotta-500 text-white font-medium'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}
            >
              {s}
              <span className={cn('text-xs px-1.5 py-0.5 rounded-full', isActive ? 'bg-white/20' : 'bg-slate-200')}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Groepen lijst */}
      {isLoading ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Snijplannen laden...
        </div>
      ) : !filteredGroepen || filteredGroepen.length === 0 ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Geen snijplannen gevonden
        </div>
      ) : (
        <div className="space-y-2">
          {filteredGroepen.map((g) => (
            <GroepAccordion
              key={`${g.kwaliteit_code}-${g.kleur_code}`}
              kwaliteitCode={g.kwaliteit_code}
              kleurCode={g.kleur_code}
              totaalStukken={g.totaal_stukken}
              totaalOrders={g.totaal_orders}
              totaalM2={g.totaal_m2}
              totaalGesneden={g.totaal_gesneden}
              totaalGepland={g.totaal_gepland ?? 0}
              totaalWacht={g.totaal_wacht ?? 0}
              totDatum={totDatum}
            />
          ))}
        </div>
      )}
    </>
  )
}
