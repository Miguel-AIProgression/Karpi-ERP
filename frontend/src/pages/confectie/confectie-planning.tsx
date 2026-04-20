import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, List, Sticker } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useWerktijden } from '@/components/werkagenda/werktijden-config'
import { LaneKolom } from '@/components/confectie/lane-kolom'
import { AfrondModal } from '@/components/confectie/afrond-modal'
import { WeekSelector, type HorizonWeken } from '@/components/confectie/week-selector'
import { berekenLanes, werkminutenTussen, type Werktijden } from '@/lib/utils/bereken-agenda'
import {
  groepeerPerLaneEnWeek,
  bezettingPerWeek,
  isoWeekKey,
  type Bezetting,
} from '@/lib/utils/confectie-forward-planner'
import { useConfectiePlanningForward, useConfectieWerktijden } from '@/hooks/use-confectie-planning'
import { formatDate } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import type {
  ConfectiePlanningRow,
  ConfectiePlanningForwardRow,
  ConfectieWerktijd,
} from '@/lib/supabase/queries/confectie-planning'

function strekkendeMeterCm(row: ConfectiePlanningForwardRow): number {
  return row.strekkende_meter_cm ?? 0
}

export function ConfectiePlanningPage() {
  const [werktijden] = useWerktijden()
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
  const horizonSet = useMemo(() => new Set(weekLabels), [weekLabels])

  // Binnen horizon én actieve lane: "teplannen"
  // Buiten lane of inactief: "geenConfectie"
  const { teplannen, geenConfectie } = useMemo(() => {
    const tp: ConfectiePlanningForwardRow[] = []
    const gc: ConfectiePlanningForwardRow[] = []
    for (const r of forward ?? []) {
      const lane = r.type_bewerking
      const cfg = lane ? tijdenMap.get(lane) : undefined
      if (!lane || !cfg || !cfg.actief || lane === 'stickeren') {
        gc.push(r)
      } else {
        tp.push(r)
      }
    }
    return { teplannen: tp, geenConfectie: gc }
  }, [forward, tijdenMap])

  // Groepeer teplannen per lane + week voor bezetting-berekening
  const laneData = useMemo(() => {
    const perLane = groepeerPerLaneEnWeek(teplannen)
    const result: Array<{
      type: string
      bezettingen: Array<{ weekLabel: string; nodigMin: number; beschikbaarMin: number }>
      blokkenInHorizon: ConfectiePlanningForwardRow[]
    }> = []
    for (const [lane, perWeek] of perLane) {
      if (lane === '__geen_lane__') continue
      const cfg = tijdenMap.get(lane)
      if (!cfg) continue
      const bezettingen = weekLabels.map((weekLabel) => {
        const items = perWeek.get(weekLabel) ?? []
        const beschikbaar = werkminutenInWeek(weekLabel, werktijden)
        const bez: Bezetting = bezettingPerWeek(items, cfg, beschikbaar)
        return { weekLabel, nodigMin: bez.nodigMin, beschikbaarMin: bez.beschikbaarMin }
      })
      const blokkenInHorizon: ConfectiePlanningForwardRow[] = []
      for (const [week, items] of perWeek) {
        if (horizonSet.has(week)) blokkenInHorizon.push(...items)
      }
      result.push({ type: lane, bezettingen, blokkenInHorizon })
    }
    return result.sort((a, b) => a.type.localeCompare(b.type))
  }, [teplannen, tijdenMap, weekLabels, horizonSet, werktijden])

  // Per lane: sequentieel plannen in de werkagenda via berekenLanes
  const laneBlokkenMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof berekenLanes<ConfectiePlanningForwardRow, string>>>()
    for (const { type, blokkenInHorizon } of laneData) {
      const cfg = tijdenMap.get(type)
      if (!cfg) continue
      const blokken = berekenLanes<ConfectiePlanningForwardRow, string>(blokkenInHorizon, werktijden, {
        laneKey: () => type,
        sortKey: (r) => r.confectie_klaar_op ?? r.confectie_startdatum,
        duur: (r) => {
          const meters = strekkendeMeterCm(r) / 100
          return meters * Number(cfg.minuten_per_meter) + cfg.wisseltijd_minuten
        },
        minStart: (r) => {
          // Gesneden stukken met rol-klaar-tijd: gebruik snijden_voltooid_op + buffer
          if (r.confectie_klaar_op) return new Date(r.confectie_klaar_op)
          // Nog-te-snijden stukken: start op begin van de geschatte confectie-startdatum
          if (r.confectie_startdatum) return new Date(r.confectie_startdatum + 'T00:00:00')
          return null
        },
      })
      map.set(type, blokken)
    }
    return map
  }, [laneData, tijdenMap, werktijden])

  const isLoading = fwLoading || tijdenLoading
  const totaal = (forward ?? []).length

  return (
    <>
      <PageHeader
        title="Confectie-planning"
        description={`${totaal} stuk${totaal !== 1 ? 'ken' : ''} — gepland per afwerkingstype`}
      />

      <ConfectieTabs active="planning" />

      <div className="mb-4 flex items-center gap-3">
        <span className="text-xs text-slate-500">Horizon:</span>
        <WeekSelector waarde={horizon} onChange={setHorizon} />
      </div>

      {isLoading ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Planning berekenen...
        </div>
      ) : laneData.length === 0 ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          <Calendar size={32} className="mx-auto mb-3 opacity-30" />
          <p>Niets om te plannen in de gekozen horizon</p>
          <p className="text-sm mt-1">Stukken verschijnen hier zodra ze in een snijplan zitten</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {laneData.map(({ type, bezettingen }) => {
            const lanesResult = laneBlokkenMap.get(type)
            const blokken = (lanesResult?.get(type) ?? []).map((b) => ({
              ...b,
              // Cast naar ConfectiePlanningRow: structureel compatibel (forward-view levert aliassen)
              item: b.item as unknown as ConfectiePlanningRow,
            }))
            return (
              <LaneKolom
                key={type}
                typeBewerking={type}
                blokken={blokken}
                bezettingen={bezettingen}
                onSelect={(row) => {
                  // Vind origineel forward-object (via confectie_id == snijplan_id)
                  const origineel = laneData
                    .find((l) => l.type === type)
                    ?.blokkenInHorizon
                    .find((r) => r.confectie_id === (row as ConfectiePlanningRow).confectie_id)
                  if (origineel) setGeselecteerd(origineel)
                }}
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

function werkminutenInWeek(weekLabel: string, werktijden: Werktijden): number {
  const [jaar, w] = weekLabel.split('-W').map(Number)
  const jan4 = new Date(jaar, 0, 4)
  const jan4Dow = (jan4.getDay() + 6) % 7 // 0 = ma
  const week1Monday = new Date(jan4)
  week1Monday.setDate(jan4.getDate() - jan4Dow)
  const maandag = new Date(week1Monday)
  maandag.setDate(week1Monday.getDate() + (w - 1) * 7)
  const zondag = new Date(maandag)
  zondag.setDate(maandag.getDate() + 7)
  return werkminutenTussen(maandag, zondag, werktijden)
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
