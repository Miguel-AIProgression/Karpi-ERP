import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, List, Sticker } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { AfrondModal } from '@/components/confectie/afrond-modal'
import { WeekSelector, type HorizonWeken } from '@/components/confectie/week-selector'
import { WeekLijst } from '@/components/confectie/week-lijst'
import { isoWeekKey } from '@/lib/utils/confectie-forward-planner'
import { useConfectiePlanningForward, useConfectieWerktijden } from '@/hooks/use-confectie-planning'
import { formatDate } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import type {
  ConfectiePlanningRow,
  ConfectiePlanningForwardRow,
  ConfectieWerktijd,
} from '@/lib/supabase/queries/confectie-planning'

export function ConfectiePlanningPage() {
  const [horizon, setHorizon] = useState<HorizonWeken>(4)
  const [geselecteerd, setGeselecteerd] = useState<ConfectiePlanningForwardRow | null>(null)
  const { data: forward, isLoading: fwLoading } = useConfectiePlanningForward()
  const { data: werktijdenConfig, isLoading: tijdenLoading } = useConfectieWerktijden()

  const tijdenMap = useMemo(() => {
    const map = new Map<string, ConfectieWerktijd>()
    for (const w of werktijdenConfig ?? []) map.set(w.type_bewerking, w)
    return map
  }, [werktijdenConfig])

  const weekLabels = useMemo(() => berekenWeeksInHorizon(horizon), [horizon])

  // Splits in "te confectioneren" (actieve lane) vs "alleen stickeren"
  const { teConfectioneren, geenConfectie } = useMemo(() => {
    const tc: ConfectiePlanningForwardRow[] = []
    const gc: ConfectiePlanningForwardRow[] = []
    for (const r of forward ?? []) {
      const lane = r.type_bewerking
      const cfg = lane ? tijdenMap.get(lane) : undefined
      if (!lane || !cfg || !cfg.actief || lane === 'stickeren') {
        gc.push(r)
      } else {
        tc.push(r)
      }
    }
    return { teConfectioneren: tc, geenConfectie: gc }
  }, [forward, tijdenMap])

  // Groepeer per week, en binnen week per lane
  const perWeek = useMemo(() => {
    const map = new Map<string, Map<string, ConfectiePlanningForwardRow[]>>()
    for (const r of teConfectioneren) {
      const week = isoWeekKey(r.confectie_startdatum)
      let lanes = map.get(week)
      if (!lanes) {
        lanes = new Map()
        map.set(week, lanes)
      }
      const lane = r.type_bewerking!  // gegarandeerd non-null via teConfectioneren
      const lijst = lanes.get(lane) ?? []
      lijst.push(r)
      lanes.set(lane, lijst)
    }
    return map
  }, [teConfectioneren])

  const isLoading = fwLoading || tijdenLoading
  const totaal = teConfectioneren.length
  const totaalGesneden = teConfectioneren.filter((r) => r.snijplan_status === 'Gesneden' || r.snijplan_status === 'In confectie').length

  return (
    <>
      <PageHeader
        title="Confectie-planning"
        description={`${totaalGesneden} klaar voor confectie · ${totaal} totaal in de pijplijn`}
      />

      <ConfectieTabs active="planning" />

      <div className="mb-4 flex items-center gap-3">
        <span className="text-xs text-slate-500">Horizon:</span>
        <WeekSelector waarde={horizon} onChange={setHorizon} />
      </div>

      {isLoading ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Planning laden...
        </div>
      ) : totaal === 0 ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          <Calendar size={32} className="mx-auto mb-3 opacity-30" />
          <p>Niets om te plannen</p>
          <p className="text-sm mt-1">Stukken verschijnen hier zodra ze in een snijplan zitten</p>
        </div>
      ) : (
        <div className="space-y-4">
          {weekLabels.map((weekLabel) => {
            const lanesMap = perWeek.get(weekLabel)
            if (!lanesMap || lanesMap.size === 0) return null
            const lanes = Array.from(lanesMap.entries())
              .map(([type, rows]) => ({ type, rows }))
              .sort((a, b) => a.type.localeCompare(b.type))
            return (
              <WeekLijst
                key={weekLabel}
                weekLabel={weekLabel}
                lanes={lanes}
                onSelect={setGeselecteerd}
              />
            )
          })}
        </div>
      )}

      {geenConfectie.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <Sticker size={14} className="text-slate-400" />
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
              Geen confectie — alleen stickeren
            </span>
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400">{geenConfectie.length} stuks</span>
          </div>
          <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                  <th className="py-2 px-4">Maat</th>
                  <th className="py-2 px-4">Rol</th>
                  <th className="py-2 px-4">Type</th>
                  <th className="py-2 px-4">Klant</th>
                  <th className="py-2 px-4">Order</th>
                  <th className="py-2 px-4">Leverdatum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {geenConfectie.map((r) => (
                  <tr
                    key={r.confectie_id}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => setGeselecteerd(r)}
                  >
                    <td className="py-2 px-4 font-medium tabular-nums">
                      {r.confectie_afgerond_op && <span className="text-emerald-600 mr-1">✓</span>}
                      {r.lengte_cm ?? '?'}×{r.breedte_cm ?? '?'} cm
                    </td>
                    <td className="py-2 px-4">
                      {r.rolnummer && r.rol_id ? (
                        <Link
                          to={`/snijplanning/productie/${r.rol_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-terracotta-600 hover:underline text-xs"
                        >
                          {r.rolnummer}
                        </Link>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="py-2 px-4 capitalize text-slate-700">
                      {r.type_bewerking ?? <span className="text-slate-400">stickeren</span>}
                    </td>
                    <td className="py-2 px-4 text-slate-700">{r.klant_naam}</td>
                    <td className="py-2 px-4 text-terracotta-600">{r.order_nr}</td>
                    <td className="py-2 px-4">
                      {r.afleverdatum ? formatDate(r.afleverdatum) : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {geselecteerd && (
        <AfrondModal stuk={geselecteerd as unknown as ConfectiePlanningRow} onClose={() => setGeselecteerd(null)} />
      )}
    </>
  )
}

function toLocalIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function berekenWeeksInHorizon(horizon: HorizonWeken): string[] {
  const vandaag = new Date()
  const weken: string[] = []
  for (let i = 0; i < horizon; i++) {
    const d = new Date(vandaag)
    d.setDate(vandaag.getDate() + i * 7)
    weken.push(isoWeekKey(toLocalIsoDate(d)))
  }
  return Array.from(new Set(weken))
}

export function ConfectieTabs({ active }: { active: 'lijst' | 'planning' }) {
  const tabs = [
    { key: 'lijst' as const, label: 'Lijst', icon: List, to: '/confectie' },
    { key: 'planning' as const, label: 'Planning', icon: Calendar, to: '/confectie/planning' },
  ]
  return (
    <div className="flex gap-1 mb-6 border-b border-slate-200">
      {tabs.map((t) => {
        const isActive = active === t.key
        return (
          <Link
            key={t.key}
            to={t.to}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-sm transition-colors border-b-2 -mb-px',
              isActive
                ? 'border-terracotta-500 text-terracotta-700 font-medium'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            <t.icon size={14} />
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
