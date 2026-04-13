import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, List, Sticker } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useWerktijden } from '@/components/werkagenda/werktijden-config'
import { LaneKolom } from '@/components/confectie/lane-kolom'
import { AfrondModal } from '@/components/confectie/afrond-modal'
import { berekenLanes, werkminutenTussen, type LaneBlok } from '@/lib/utils/bereken-agenda'
import { useConfectiePlanning, useConfectieWerktijden } from '@/hooks/use-confectie-planning'
import { formatDate } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import type { ConfectiePlanningRow, ConfectieWerktijd } from '@/lib/supabase/queries/confectie-planning'

function strekkendeMeter(row: ConfectiePlanningRow): number {
  const l = row.lengte_cm ?? 0
  const b = row.breedte_cm ?? 0
  if (!l && !b) return 0
  const vorm = (row.vorm ?? '').toLowerCase()
  // Rond/ovaal: omtrek via langste zijde als diameter → π × d
  if (vorm === 'rond' || vorm === 'ovaal') return (Math.PI * Math.max(l, b)) / 100
  // Rechthoek / overig: omtrek = 2 × (l + b)
  return (2 * (l + b)) / 100
}

export function ConfectiePlanningPage() {
  const [werktijden] = useWerktijden()
  const [geselecteerd, setGeselecteerd] = useState<ConfectiePlanningRow | null>(null)
  const { data: planning, isLoading: planLoading } = useConfectiePlanning()
  const { data: werktijdenConfig, isLoading: tijdenLoading } = useConfectieWerktijden()

  const tijdenMap = useMemo(() => {
    const map = new Map<string, ConfectieWerktijd>()
    for (const w of werktijdenConfig ?? []) map.set(w.type_bewerking, w)
    return map
  }, [werktijdenConfig])

  const { teplannen, geenConfectie } = useMemo(() => {
    const tp: ConfectiePlanningRow[] = []
    const gc: ConfectiePlanningRow[] = []
    for (const r of planning ?? []) {
      const cfg = tijdenMap.get(r.type_bewerking)
      if (!cfg || !cfg.actief || r.type_bewerking === 'stickeren') {
        gc.push(r)
      } else {
        tp.push(r)
      }
    }
    return { teplannen: tp, geenConfectie: gc }
  }, [planning, tijdenMap])

  const lanes = useMemo(() => {
    if (!teplannen.length || !werktijdenConfig) return new Map<string, LaneBlok<ConfectiePlanningRow>[]>()
    return berekenLanes<ConfectiePlanningRow, string>(teplannen, werktijden, {
      laneKey: (r) => r.type_bewerking,
      sortKey: (r) => r.afleverdatum ?? '9999-12-31',
      duur: (r) => {
        const cfg = tijdenMap.get(r.type_bewerking)
        if (!cfg) return 0
        const meters = strekkendeMeter(r)
        return meters * Number(cfg.minuten_per_meter) + cfg.wisseltijd_minuten
      },
    })
  }, [teplannen, werktijden, werktijdenConfig, tijdenMap])

  const laneEntries = useMemo(() => Array.from(lanes.entries()), [lanes])
  const isLoading = planLoading || tijdenLoading
  const totaal = (planning ?? []).length

  const { totaalNodigMin, restWeekMin } = useMemo(() => {
    // Lanes lopen parallel → wall-clock = max som van één lane
    let nodig = 0
    for (const [, blokken] of lanes) {
      const laneSom = blokken.reduce((s, b) => s + b.duurMinuten, 0)
      if (laneSom > nodig) nodig = laneSom
    }
    const nu = new Date()
    const eindWeek = new Date(nu)
    const js = eindWeek.getDay()
    const iso = js === 0 ? 7 : js
    eindWeek.setDate(eindWeek.getDate() + (7 - iso))
    eindWeek.setHours(23, 59, 59, 999)
    const rest = werkminutenTussen(nu, eindWeek, werktijden)
    return { totaalNodigMin: Math.round(nodig), restWeekMin: rest }
  }, [lanes, werktijden])

  const fmtHM = (m: number) => {
    const u = Math.floor(m / 60)
    const r = Math.round(m % 60)
    return u > 0 ? `${u}u ${r}m` : `${r}m`
  }
  const past = totaalNodigMin <= restWeekMin

  return (
    <>
      <PageHeader
        title="Confectie-planning"
        description={`${totaal} stuk${totaal !== 1 ? 'ken' : ''} — gepland per afwerkingstype`}
      />

      <ConfectieTabs active="planning" />

      {teplannen.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[var(--radius)] border border-slate-200 bg-white px-4 py-3 text-sm">
          <div>
            <span className="text-slate-500">Totaal benodigd: </span>
            <span className="font-semibold tabular-nums">{fmtHM(totaalNodigMin)}</span>
          </div>
          <div>
            <span className="text-slate-500">Nog beschikbaar deze week: </span>
            <span className="font-semibold tabular-nums">{fmtHM(restWeekMin)}</span>
          </div>
          <div className={cn(
            'ml-auto px-2 py-0.5 rounded-full text-xs font-medium',
            past ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
          )}>
            {past ? 'Past binnen week' : `Tekort ${fmtHM(totaalNodigMin - restWeekMin)}`}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Planning berekenen...
        </div>
      ) : laneEntries.length === 0 ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          <Calendar size={32} className="mx-auto mb-3 opacity-30" />
          <p>Niets om te plannen</p>
          <p className="text-sm mt-1">Stukken verschijnen hier als ze status 'Wacht op materiaal' of 'In productie' hebben</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {laneEntries.map(([type, blokken]) => (
            <LaneKolom key={type} typeBewerking={type} blokken={blokken} onSelect={setGeselecteerd} />
          ))}
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
                    <td className="py-2 px-4 capitalize text-slate-700">{r.type_bewerking}</td>
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
        <AfrondModal stuk={geselecteerd} onClose={() => setGeselecteerd(null)} />
      )}
    </>
  )
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
