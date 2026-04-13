import { useState, useMemo, Fragment } from 'react'
import { Search, Scissors, Calendar, CheckCircle2, Factory, AlertTriangle } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { GroepAccordion } from '@/components/snijplanning/groep-accordion'
import { AutoPlanningConfig } from '@/components/snijplanning/auto-planning-config'
import { cn } from '@/lib/utils/cn'
import { useSnijplanningGroepen, useSnijplanningStatusCounts, useAutoplanningConfig } from '@/hooks/use-snijplanning'
import { berekenTotDatum } from '@/components/snijplanning/week-filter'

const SNIJPLAN_STATUSES = ['Alle', 'Tekort', 'Snijden']
type SortMode = 'alfabetisch' | 'leverdatum'

function sorteerGroepen<T extends { kleur_code: string; vroegste_afleverdatum: string | null }>(
  lijst: T[],
  mode: SortMode,
): T[] {
  const copy = [...lijst]
  if (mode === 'leverdatum') {
    copy.sort((a, b) => {
      const aD = a.vroegste_afleverdatum
      const bD = b.vroegste_afleverdatum
      if (aD === bD) return a.kleur_code.localeCompare(b.kleur_code)
      if (!aD) return 1
      if (!bD) return -1
      return aD.localeCompare(bD)
    })
  } else {
    copy.sort((a, b) => a.kleur_code.localeCompare(b.kleur_code))
  }
  return copy
}

export function SnijplanningOverviewPage() {
  const [status, setStatus] = useState('Alle')
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('leverdatum')
  const { data: autoConfig } = useAutoplanningConfig()

  // Gebruik de auto-planning horizon als filter (als die aan staat)
  const horizonWeken = autoConfig?.enabled ? autoConfig.horizon_weken : null
  const totDatum = berekenTotDatum(horizonWeken)

  const { data: groepen, isLoading } = useSnijplanningGroepen(search || undefined, totDatum)
  const { data: statusCounts } = useSnijplanningStatusCounts(totDatum)

  // Groepen met tekort: stukken zonder rol (niet gepland) terwijl rollen nodig zijn
  const tekortGroepen = useMemo(() => {
    if (!groepen) return []
    return groepen.filter((g) => (g.totaal_snijden ?? 0) - (g.totaal_snijden_gepland ?? 0) > 0)
  }, [groepen])

  // Verberg groepen waar alle stukken al gesneden zijn — die staan in de confectielijst
  const actieveGroepen = useMemo(() => {
    if (!groepen) return []
    return groepen.filter((g) => (g.totaal_snijden ?? 0) > 0)
  }, [groepen])

  // Client-side filtering
  const filteredGroepen = useMemo(() => {
    if (status === 'Alle') return actieveGroepen
    if (status === 'Tekort') return tekortGroepen
    if (status === 'Snijden') return actieveGroepen
    return actieveGroepen
  }, [actieveGroepen, status, tekortGroepen])

  // Bij 'leverdatum': platte lijst gesorteerd op vroegste leverdatum (null achteraan).
  // Bij 'alfabetisch': gegroepeerd per kwaliteit voor overzicht.
  const platteGroepen = useMemo(
    () => sorteerGroepen(filteredGroepen, 'leverdatum'),
    [filteredGroepen],
  )
  const groepenPerKwaliteit = useMemo(() => {
    const map = new Map<string, typeof filteredGroepen>()
    for (const g of filteredGroepen) {
      const lijst = map.get(g.kwaliteit_code) ?? []
      lijst.push(g)
      map.set(g.kwaliteit_code, lijst)
    }
    for (const [code, lijst] of map.entries()) {
      map.set(code, sorteerGroepen(lijst, 'alfabetisch'))
    }
    const entries = Array.from(map.entries())
    entries.sort(([a], [b]) => a.localeCompare(b))
    return entries
  }, [filteredGroepen])

  const countMap = new Map((statusCounts ?? []).map((c) => [c.status, c.aantal]))
  const allCount = (statusCounts ?? [])
    .filter((c) => c.status === 'Snijden')
    .reduce((sum, c) => sum + c.aantal, 0)

  // Aggregeer stats uit de groepen — matcht de nieuwe 3-fase workflow
  const stats = useMemo(() => {
    const g = groepen ?? []
    const snijdenZonderRol = g.reduce((s, x) => s + (x.totaal_snijden ?? 0) - (x.totaal_snijden_gepland ?? 0), 0)
    const snijdenGepland = g.reduce((s, x) => s + (x.totaal_snijden_gepland ?? 0), 0)
    const gesneden = g.reduce((s, x) => s + (x.totaal_status_gesneden ?? 0), 0)
    const inConfectie = g.reduce((s, x) => s + (x.totaal_in_confectie ?? 0) + (x.totaal_gereed ?? 0), 0)
    return [
      { label: 'Wacht op planning', value: snijdenZonderRol, icon: Scissors, color: 'text-slate-700' },
      { label: 'Gepland', value: snijdenGepland, icon: Calendar, color: 'text-blue-600' },
      { label: 'Gesneden', value: gesneden, icon: CheckCircle2, color: 'text-emerald-600' },
      { label: 'In confectie', value: inConfectie, icon: Factory, color: 'text-indigo-600' },
    ]
  }, [groepen])

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

      {/* Search + auto-planning config */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
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
        <div className="flex items-center gap-2">
          <div className="flex rounded-[var(--radius-sm)] border border-slate-200 overflow-hidden text-xs">
            <button
              onClick={() => setSortMode('leverdatum')}
              className={cn(
                'px-3 py-1.5 transition-colors',
                sortMode === 'leverdatum' ? 'bg-terracotta-500 text-white font-medium' : 'bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              Leverdatum
            </button>
            <button
              onClick={() => setSortMode('alfabetisch')}
              className={cn(
                'px-3 py-1.5 transition-colors border-l border-slate-200',
                sortMode === 'alfabetisch' ? 'bg-terracotta-500 text-white font-medium' : 'bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              Alfabetisch
            </button>
          </div>
          <AutoPlanningConfig />
        </div>
      </div>

      {/* Tekort banner */}
      {tekortGroepen.length > 0 && status !== 'Tekort' && (
        <div className="flex items-center gap-2 px-4 py-3 mb-4 bg-red-50 border border-red-200 rounded-[var(--radius)] text-sm text-red-700">
          <AlertTriangle size={16} className="flex-shrink-0" />
          <span>
            <strong>{tekortGroepen.length} groepen</strong> hebben onvoldoende rollen —{' '}
            {tekortGroepen.reduce((sum, g) => sum + (g.totaal_snijden ?? 0), 0)} stukken wachten op materiaal.
          </span>
          <button
            onClick={() => setStatus('Tekort')}
            className="ml-auto px-2 py-1 text-xs font-medium bg-red-100 hover:bg-red-200 rounded transition-colors"
          >
            Bekijk tekorten
          </button>
        </div>
      )}

      {/* Status tabs */}
      <div className="flex gap-1 overflow-x-auto pb-2 mb-4">
        {SNIJPLAN_STATUSES.map((s) => {
          const count = s === 'Alle' ? allCount
            : s === 'Tekort' ? tekortGroepen.length
            : (countMap.get(s) ?? 0)
          const isActive = status === s
          const isTekort = s === 'Tekort'
          return (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors',
                isActive && isTekort
                  ? 'bg-red-500 text-white font-medium'
                  : isActive
                  ? 'bg-terracotta-500 text-white font-medium'
                  : isTekort && count > 0
                  ? 'bg-red-50 text-red-700 hover:bg-red-100'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}
            >
              {isTekort && <AlertTriangle size={12} />}
              {s}
              <span className={cn(
                'text-xs px-1.5 py-0.5 rounded-full',
                isActive ? 'bg-white/20'
                  : isTekort && count > 0 ? 'bg-red-200'
                  : 'bg-slate-200'
              )}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Groepen lijst — gegroepeerd per kwaliteit, altijd uitgeklapt */}
      {isLoading ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Snijplannen laden...
        </div>
      ) : filteredGroepen.length === 0 ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Geen snijplannen gevonden
        </div>
      ) : sortMode === 'leverdatum' ? (
        <div className="space-y-2">
          {platteGroepen.map((g) => (
            <GroepAccordion
              key={`${g.kwaliteit_code}-${g.kleur_code}`}
              kwaliteitCode={g.kwaliteit_code}
              kleurCode={g.kleur_code}
              totaalStukken={g.totaal_stukken}
              totaalOrders={g.totaal_orders}
              totaalM2={g.totaal_m2}
              totaalGesneden={g.totaal_gesneden}
              totaalSnijden={g.totaal_snijden ?? 0}
              totaalSnijdenGepland={g.totaal_snijden_gepland ?? 0}
              totDatum={totDatum}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {groepenPerKwaliteit.map(([kwaliteitCode, groepen]) => {
            const totStukken = groepen.reduce((s, g) => s + g.totaal_stukken, 0)
            const totM2 = groepen.reduce((s, g) => s + g.totaal_m2, 0)
            return (
              <Fragment key={kwaliteitCode}>
                <div className="flex items-center gap-3 pt-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">
                    {kwaliteitCode}
                  </span>
                  <div className="flex-1 h-px bg-slate-200" />
                  <span className="text-xs text-slate-400 whitespace-nowrap">
                    {groepen.length} {groepen.length === 1 ? 'kleur' : 'kleuren'}
                    {' · '}{totStukken} stuks · {Math.round(totM2)} m²
                  </span>
                </div>
                <div className="space-y-2">
                  {groepen.map((g) => (
                    <GroepAccordion
                      key={`${g.kwaliteit_code}-${g.kleur_code}`}
                      kwaliteitCode={g.kwaliteit_code}
                      kleurCode={g.kleur_code}
                      totaalStukken={g.totaal_stukken}
                      totaalOrders={g.totaal_orders}
                      totaalM2={g.totaal_m2}
                      totaalGesneden={g.totaal_gesneden}
                      totaalSnijden={g.totaal_snijden ?? 0}
                      totaalSnijdenGepland={g.totaal_snijden_gepland ?? 0}
                      totDatum={totDatum}
                    />
                  ))}
                </div>
              </Fragment>
            )
          })}
        </div>
      )}
    </>
  )
}
