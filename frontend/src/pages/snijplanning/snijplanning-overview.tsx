import { useState, useMemo, Fragment } from 'react'
import { Search, Scissors, Calendar, CheckCircle2, AlertTriangle, List } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { GroepAccordion } from '@/components/snijplanning/groep-accordion'
import { AutoPlanningConfig } from '@/components/snijplanning/auto-planning-config'
import { AgendaWeergave } from '@/components/snijplanning/agenda-weergave'
import { cn } from '@/lib/utils/cn'
import { useSnijplanningGroepen, useTekortAnalyse, useSnijplanningKpis } from '@/hooks/use-snijplanning'
import { usePlanningConfig } from '@/hooks/use-planning-config'
import { berekenTotDatum } from '@/components/snijplanning/week-filter'

const SNIJPLAN_STATUSES = ['Te snijden', 'Tekort']
type SortMode = 'alfabetisch' | 'leverdatum'

function sorteerGroepen<T extends { kwaliteit_code: string | null; kleur_code: string | null; vroegste_afleverdatum: string | null }>(
  lijst: T[],
  mode: SortMode,
): T[] {
  // Null-safe string compare: NULL altijd achteraan, anders localeCompare.
  const cmp = (a: string | null | undefined, b: string | null | undefined): number => {
    if (a === b) return 0
    if (a == null) return 1
    if (b == null) return -1
    return a.localeCompare(b)
  }
  const copy = [...lijst]
  if (mode === 'leverdatum') {
    // Consistente tie-break met de Agenda-weergave (bereken-agenda.ts):
    // leverdatum → kwaliteit → kleur. Zonder kwaliteit als eerste tie-break
    // zou kleur '11' van OASI vóór kleur '12' van CAVA komen, terwijl de
    // Agenda op rolnummer CAVA eerst zet — verwarrend voor de planner.
    copy.sort((a, b) => {
      const d = cmp(a.vroegste_afleverdatum, b.vroegste_afleverdatum)
      if (d !== 0) return d
      const k = cmp(a.kwaliteit_code, b.kwaliteit_code)
      if (k !== 0) return k
      return cmp(a.kleur_code, b.kleur_code)
    })
  } else {
    // Kwaliteit → kleur → leverdatum (oudste eerst, NULL achteraan)
    copy.sort((a, b) => {
      const k = cmp(a.kwaliteit_code, b.kwaliteit_code)
      if (k !== 0) return k
      const c = cmp(a.kleur_code, b.kleur_code)
      if (c !== 0) return c
      return cmp(a.vroegste_afleverdatum, b.vroegste_afleverdatum)
    })
  }
  return copy
}

export function SnijplanningOverviewPage() {
  const [tab, setTab] = useState<'lijst' | 'agenda'>('lijst')
  const [status, setStatus] = useState('Te snijden')
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('leverdatum')
  const { data: planningConfig } = usePlanningConfig()

  // Planning horizon: `weken_vooruit` uit Productie Instellingen is de
  // single source of truth. Altijd actief — orders met leverdatum voorbij de
  // horizon vallen buiten de snijplanning.
  const horizonWeken = planningConfig?.weken_vooruit ?? null
  const totDatum = berekenTotDatum(horizonWeken)

  const { data: groepen, isLoading } = useSnijplanningGroepen(search || undefined, totDatum)
  const { data: tekortAnalyseMap } = useTekortAnalyse()
  const { data: kpis } = useSnijplanningKpis(totDatum)

  // Groepen met tekort: stukken zonder rol (niet gepland) terwijl rollen nodig zijn
  const tekortGroepen = useMemo(() => {
    if (!groepen) return []
    return groepen.filter((g) => (g.totaal_snijden ?? 0) - (g.totaal_snijden_gepland ?? 0) > 0)
  }, [groepen])

  // Te snijden: groepen met minimaal één stuk dat een rol toegewezen heeft.
  // Dit is de werklijst voor snijders — tekorten (stukken zonder rol) zijn
  // voor inkoop en verschijnen in de Tekort-tab.
  const teSnijdenGroepen = useMemo(() => {
    if (!groepen) return []
    return groepen.filter((g) => (g.totaal_snijden_gepland ?? 0) > 0)
  }, [groepen])

  // Client-side filtering
  const filteredGroepen = useMemo(() => {
    if (status === 'Tekort') return tekortGroepen
    return teSnijdenGroepen
  }, [teSnijdenGroepen, status, tekortGroepen])

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
    entries.sort(([a], [b]) => {
      if (a === b) return 0
      if (a == null) return 1
      if (b == null) return -1
      return a.localeCompare(b)
    })
    return entries
  }, [filteredGroepen])

  const teSnijdenCount = useMemo(
    () => teSnijdenGroepen.reduce((sum, g) => sum + (g.totaal_snijden_gepland ?? 0), 0),
    [teSnijdenGroepen],
  )

  // KPI cards: gefocust op de actieve planning-horizon + deze week
  const stats = useMemo(() => {
    const horizonLabel =
      horizonWeken !== null
        ? `Binnen horizon (${horizonWeken} ${horizonWeken === 1 ? 'wk' : 'wkn'})`
        : 'Binnen horizon'
    return [
      {
        label: horizonLabel,
        value: kpis?.binnen_horizon ?? 0,
        icon: Scissors,
        color: 'text-slate-700',
      },
      {
        label: 'Te snijden deze week',
        value: kpis?.deze_week_te_snijden ?? 0,
        icon: Calendar,
        color: 'text-blue-600',
      },
      {
        label: 'Gesneden deze week',
        value: kpis?.deze_week_gesneden ?? 0,
        icon: CheckCircle2,
        color: 'text-emerald-600',
      },
    ]
  }, [kpis, horizonWeken])

  return (
    <>
      <PageHeader
        title="Snijplanning"
        description={
          horizonWeken !== null && totDatum
            ? `${filteredGroepen.length ?? 0} kwaliteit/kleur groepen — ${teSnijdenCount} snijplannen · horizon ${horizonWeken} ${horizonWeken === 1 ? 'week' : 'weken'} (t/m ${new Date(totDatum + 'T00:00:00').toLocaleDateString('nl-NL')})`
            : `${filteredGroepen.length ?? 0} kwaliteit/kleur groepen — ${teSnijdenCount} snijplannen`
        }
      />

      {/* Tab switcher */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {([
          { key: 'lijst' as const, label: 'Lijst', icon: List },
          { key: 'agenda' as const, label: 'Agenda', icon: Calendar },
        ]).map((t) => {
          const isActive = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 text-sm transition-colors border-b-2 -mb-px',
                isActive
                  ? 'border-terracotta-500 text-terracotta-700 font-medium'
                  : 'border-transparent text-slate-500 hover:text-slate-700',
              )}
            >
              <t.icon size={14} />
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'agenda' ? <AgendaWeergave /> : <LijstWeergave />}
    </>
  )

  function LijstWeergave() {
    return (
      <>
      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
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
          const count = s === 'Tekort' ? tekortGroepen.length : teSnijdenCount
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
          {platteGroepen.map((g, idx) => {
            const kleurKey = g.kleur_code.replace(/\.0$/, '')
            return (
            <GroepAccordion
              key={`${g.kwaliteit_code}-${g.kleur_code}`}
              kwaliteitCode={g.kwaliteit_code}
              kleurCode={g.kleur_code}
              totaalOrders={g.totaal_orders}
              totaalSnijden={g.totaal_snijden ?? 0}
              totaalSnijdenGepland={g.totaal_snijden_gepland ?? 0}
              modus={status === 'Tekort' ? 'tekort' : 'te-snijden'}
              totDatum={totDatum}
              defaultOpen={idx === 0}
              tekortAnalyse={tekortAnalyseMap?.get(`${g.kwaliteit_code}_${kleurKey}`) ?? null}
            />
            )
          })}
        </div>
      ) : (
        <div className="space-y-6">
          {groepenPerKwaliteit.map(([kwaliteitCode, groepen], kIdx) => {
            const totStukken = groepen.reduce((s, g) => s + (g.totaal_snijden ?? 0), 0)
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
                  {groepen.map((g, gIdx) => {
                    const kleurKey = g.kleur_code.replace(/\.0$/, '')
                    return (
                    <GroepAccordion
                      key={`${g.kwaliteit_code}-${g.kleur_code}`}
                      kwaliteitCode={g.kwaliteit_code}
                      kleurCode={g.kleur_code}
                      totaalOrders={g.totaal_orders}
                      totaalSnijden={g.totaal_snijden ?? 0}
                      totaalSnijdenGepland={g.totaal_snijden_gepland ?? 0}
                      modus={status === 'Tekort' ? 'tekort' : 'te-snijden'}
                      totDatum={totDatum}
                      defaultOpen={kIdx === 0 && gIdx === 0}
                      tekortAnalyse={tekortAnalyseMap?.get(`${g.kwaliteit_code}_${kleurKey}`) ?? null}
                    />
                    )
                  })}
                </div>
              </Fragment>
            )
          })}
        </div>
      )}
      </>
    )
  }
}
