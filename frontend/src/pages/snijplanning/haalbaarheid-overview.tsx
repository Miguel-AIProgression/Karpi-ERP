import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, Search, AlertTriangle } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { cn } from '@/lib/utils/cn'
import { formatDate } from '@/lib/utils/formatters'
import { snijplanBadgeClass } from '@/lib/utils/constants'
import { useMaatwerkHaalbaarheid } from '@/modules/snijplanning'
import type { MaatwerkHaalbaarheidRow } from '@/modules/snijplanning'
import { usePlanningConfig } from '@/hooks/use-planning-config'
import { useQuery } from '@tanstack/react-query'
import { fetchWerkagendaConfig } from '@/lib/supabase/queries/werkagenda'
import { berekenHaalbaarheid, type HaalbaarheidStatus } from '@/lib/orders/snij-haalbaarheid'
import { isoDatum } from '@/lib/utils/bereken-agenda'
import { verzendWeekVoor } from '@/lib/orders/verzendweek'

type SortKey = 'status' | 'marge' | 'leverdatum' | 'klant'
type SortDir = 'asc' | 'desc'

const STATUS_VOLGORDE: Record<HaalbaarheidStatus, number> = { rood: 0, oranje: 1, groen: 2 }

const STATUS_BADGE: Record<HaalbaarheidStatus, { bg: string; text: string; label: string }> = {
  rood: { bg: 'bg-red-100', text: 'text-red-700', label: 'Niet haalbaar' },
  oranje: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Risico' },
  groen: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Oké' },
}

interface HaalbaarheidsRij extends MaatwerkHaalbaarheidRow {
  snijDeadline: string
  margeWerkdagen: number
  haalbaarheidStatus: HaalbaarheidStatus
  inkoopInfo?: { inkooporder_nr: string; verwacht_datum: string | null }
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown size={12} className="text-slate-300" />
  return dir === 'asc' ? <ArrowUp size={12} className="text-slate-600" /> : <ArrowDown size={12} className="text-slate-600" />
}

export function HaalbaarheidOverviewPage() {
  const [zoek, setZoek] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const { data: haalbaarheid, isLoading } = useMaatwerkHaalbaarheid()
  const { data: planningConfig } = usePlanningConfig()
  const { data: werktijden } = useQuery({ queryKey: ['werkagenda-config'], queryFn: fetchWerkagendaConfig })

  const rijen = useMemo<HaalbaarheidsRij[]>(() => {
    if (!haalbaarheid || !planningConfig || !werktijden) return []
    const vandaag = isoDatum(new Date())
    return haalbaarheid.rows
      .filter((r) => r.afleverdatum != null)
      .map((r) => {
        const { snijDeadline, margeWerkdagen, status } = berekenHaalbaarheid(
          r.afleverdatum!,
          r.lever_type ?? 'week',
          planningConfig,
          werktijden,
          vandaag,
        )
        const inkoopInfo = r.verwacht_inkooporder_regel_id != null
          ? haalbaarheid.inkoopInfo.get(r.verwacht_inkooporder_regel_id)
          : undefined
        return { ...r, snijDeadline, margeWerkdagen, haalbaarheidStatus: status, inkoopInfo }
      })
  }, [haalbaarheid, planningConfig, werktijden])

  const filtered = useMemo(() => {
    if (!zoek.trim()) return rijen
    const q = zoek.toLowerCase()
    return rijen.filter(
      (r) =>
        r.order_nr.toLowerCase().includes(q) ||
        r.klant_naam.toLowerCase().includes(q) ||
        (r.kwaliteit_code ?? '').toLowerCase().includes(q) ||
        (r.kleur_code ?? '').toLowerCase().includes(q),
    )
  }, [rijen, zoek])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'status') {
        cmp = STATUS_VOLGORDE[a.haalbaarheidStatus] - STATUS_VOLGORDE[b.haalbaarheidStatus]
        if (cmp === 0) cmp = a.margeWerkdagen - b.margeWerkdagen
      } else if (sortKey === 'marge') {
        cmp = a.margeWerkdagen - b.margeWerkdagen
      } else if (sortKey === 'leverdatum') {
        cmp = (a.afleverdatum ?? '').localeCompare(b.afleverdatum ?? '')
      } else if (sortKey === 'klant') {
        cmp = a.klant_naam.localeCompare(b.klant_naam, 'nl-NL', { sensitivity: 'base' })
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [filtered, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('asc')
      return
    }
    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
  }

  const aantalRood = rijen.filter((r) => r.haalbaarheidStatus === 'rood').length
  const aantalOranje = rijen.filter((r) => r.haalbaarheidStatus === 'oranje').length
  const aantalGroen = rijen.filter((r) => r.haalbaarheidStatus === 'groen').length

  return (
    <>
      <PageHeader
        title="Haalbaarheid maatwerk"
        description={`${rijen.length} maatwerk-stukken nog te snijden — welke halen hun snij-deadline?`}
      />

      <div className="flex gap-4 text-sm mb-4">
        <span className="flex items-center gap-1.5 text-red-700 font-medium">
          <AlertTriangle size={14} /> {aantalRood} niet haalbaar
        </span>
        <span className="text-amber-700 font-medium">{aantalOranje} risico</span>
        <span className="text-emerald-700">{aantalGroen} oké</span>
      </div>

      <div className="relative w-80 mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={zoek}
          onChange={(e) => setZoek(e.target.value)}
          placeholder="Zoek op order, klant, kwaliteit, kleur..."
          className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
        />
      </div>

      <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400">Laden...</div>
        ) : sorted.length === 0 ? (
          <div className="p-12 text-center text-slate-400">Geen maatwerk-stukken gevonden</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Order</th>
                <th className="px-4 py-3 text-left font-medium">
                  <button onClick={() => toggleSort('klant')} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                    Klant <SortIcon active={sortKey === 'klant'} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium">Kwaliteit · Kleur</th>
                <th className="px-4 py-3 text-left font-medium">Maat</th>
                <th className="px-4 py-3 text-left font-medium">
                  <button onClick={() => toggleSort('leverdatum')} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                    Leverdatum <SortIcon active={sortKey === 'leverdatum'} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium">Snijplan-status</th>
                <th className="px-4 py-3 text-left font-medium">Snij-deadline</th>
                <th className="px-4 py-3 text-right font-medium">
                  <button onClick={() => toggleSort('marge')} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                    Marge <SortIcon active={sortKey === 'marge'} dir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  <button onClick={() => toggleSort('status')} className="inline-flex items-center gap-1.5 hover:text-slate-900">
                    Haalbaarheid <SortIcon active={sortKey === 'status'} dir={sortDir} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((r) => {
                const badge = STATUS_BADGE[r.haalbaarheidStatus]
                const isWeek = (r.lever_type ?? 'week') === 'week'
                const verzendweek = isWeek ? verzendWeekVoor(r.afleverdatum) : null
                return (
                  <tr key={r.id} className={cn('hover:bg-slate-50/60', r.haalbaarheidStatus === 'rood' && 'bg-red-50/30')}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link to={`/orders/${r.order_id}`} className="font-medium text-terracotta-600 hover:underline">
                        {r.order_nr}
                      </Link>
                      <div className="text-xs text-slate-400">{r.snijplan_nr}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{r.klant_naam}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{r.kwaliteit_code} · {r.kleur_code}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {r.snij_breedte_cm}×{r.snij_lengte_cm} cm{r.maatwerk_vorm ? ` (${r.maatwerk_vorm})` : ''}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {isWeek && verzendweek ? (
                        <span>wk {verzendweek.week}/{verzendweek.jaar}</span>
                      ) : (
                        <span>{formatDate(r.afleverdatum)}</span>
                      )}
                      <div className="text-xs text-slate-400">{isWeek ? 'week-order' : 'dag-order'}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={cn('text-xs px-1.5 py-0.5 rounded', snijplanBadgeClass(r.status))}>{r.status}</span>
                      {r.rolnummer && <div className="text-xs text-slate-400 mt-0.5">Rol {r.rolnummer}</div>}
                      {r.inkoopInfo && (
                        <div className="text-xs text-orange-600 mt-0.5">
                          via {r.inkoopInfo.inkooporder_nr}{r.inkoopInfo.verwacht_datum ? ` (${formatDate(r.inkoopInfo.verwacht_datum)})` : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">{formatDate(r.snijDeadline)}</td>
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                      {r.margeWerkdagen} {r.margeWerkdagen === 1 ? 'werkdag' : 'werkdagen'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', badge.bg, badge.text)}>
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
