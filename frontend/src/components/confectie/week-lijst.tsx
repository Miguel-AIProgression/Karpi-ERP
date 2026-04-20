import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Circle } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { confectieDeadline } from '@/lib/utils/confectie-deadline'
import { AFWERKING_MAP } from '@/lib/utils/constants'
import type { ConfectiePlanningForwardRow } from '@/lib/supabase/queries/confectie-planning'

const MAAND_KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

function parseIsoWeek(label: string): { jaar: number; week: number } {
  const [j, w] = label.split('-W').map(Number)
  return { jaar: j, week: w }
}

function isoWeekRange(jaar: number, week: number): { van: Date; tot: Date } {
  const jan4 = new Date(jaar, 0, 4)
  const jan4Dow = (jan4.getDay() + 6) % 7 // 0 = ma
  const week1Monday = new Date(jan4)
  week1Monday.setDate(jan4.getDate() - jan4Dow)
  const maandag = new Date(week1Monday)
  maandag.setDate(week1Monday.getDate() + (week - 1) * 7)
  const zondag = new Date(maandag)
  zondag.setDate(maandag.getDate() + 6)
  return { van: maandag, tot: zondag }
}

function fmtRange(van: Date, tot: Date): string {
  const zelfdeMaand = van.getMonth() === tot.getMonth()
  const vanStr = zelfdeMaand ? `${van.getDate()}` : `${van.getDate()} ${MAAND_KORT[van.getMonth()]}`
  const totStr = `${tot.getDate()} ${MAAND_KORT[tot.getMonth()]}`
  return `${vanStr} – ${totStr}`
}

function fmtDeadline(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function isGesneden(row: ConfectiePlanningForwardRow): boolean {
  return row.snijplan_status === 'Gesneden' || row.snijplan_status === 'In confectie'
}

function sortRows(rows: ConfectiePlanningForwardRow[]): ConfectiePlanningForwardRow[] {
  return [...rows].sort((a, b) => {
    // 1. Deadline oplopend (null achteraan)
    const da = a.afleverdatum ?? '9999-12-31'
    const db = b.afleverdatum ?? '9999-12-31'
    if (da !== db) return da.localeCompare(db)
    // 2. Gesneden stukken eerst (direct oppakbaar)
    const ga = isGesneden(a) ? 0 : 1
    const gb = isGesneden(b) ? 0 : 1
    if (ga !== gb) return ga - gb
    // 3. Snijplan-nr voor stabiele volgorde
    return (a.snijplan_nr ?? '').localeCompare(b.snijplan_nr ?? '')
  })
}

interface LaneGroep {
  type: string
  rows: ConfectiePlanningForwardRow[]
}

interface Props {
  weekLabel: string
  lanes: LaneGroep[]
  onSelect?: (row: ConfectiePlanningForwardRow) => void
}

export function WeekLijst({ weekLabel, lanes, onSelect }: Props) {
  const { jaar, week } = parseIsoWeek(weekLabel)
  const { van, tot } = isoWeekRange(jaar, week)

  // Filter lanes met minimaal 1 stuk
  const nietLeeg = lanes.filter((l) => l.rows.length > 0)
  if (nietLeeg.length === 0) return null

  const totaal = nietLeeg.reduce((s, l) => s + l.rows.length, 0)
  const klaar = nietLeeg.reduce((s, l) => s + l.rows.filter(isGesneden).length, 0)

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4">
        <div>
          <span className="text-sm font-semibold text-slate-900">Week {week}</span>
          <span className="text-sm text-slate-500"> · {fmtRange(van, tot)}</span>
        </div>
        <div className="text-xs text-slate-500 tabular-nums">
          <span className="text-emerald-600 font-medium">{klaar}</span>
          <span className="text-slate-400"> / </span>
          <span>{totaal}</span>
          <span className="text-slate-400"> klaar voor confectie</span>
        </div>
      </div>

      {nietLeeg.map((laneGroep, i) => (
        <LaneBlok key={laneGroep.type} laneGroep={laneGroep} onSelect={onSelect} isFirst={i === 0} />
      ))}
    </div>
  )
}

function LaneBlok({ laneGroep, onSelect, isFirst }: { laneGroep: LaneGroep; onSelect?: (row: ConfectiePlanningForwardRow) => void; isFirst: boolean }) {
  const rows = sortRows(laneGroep.rows)

  return (
    <div className={cn(!isFirst && 'border-t border-slate-200')}>
      <div className="px-4 py-1.5 bg-slate-50/50 text-xs font-semibold text-slate-600 uppercase tracking-wider capitalize flex items-center justify-between">
        <span>{laneGroep.type}</span>
        <span className="text-slate-400 normal-case tracking-normal">{rows.length} stuk{rows.length !== 1 ? 's' : ''}</span>
      </div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <Rij key={r.snijplan_id} row={r} onSelect={onSelect} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Rij({ row, onSelect }: { row: ConfectiePlanningForwardRow; onSelect?: (row: ConfectiePlanningForwardRow) => void }) {
  const gesneden = isGesneden(row)
  const afgerond = !!row.confectie_afgerond_op
  const deadline = confectieDeadline(row.afleverdatum)
  const teLaat = !!deadline && new Date() > deadline
  const afwMap = row.maatwerk_afwerking ? AFWERKING_MAP[row.maatwerk_afwerking] : null

  return (
    <tr
      className={cn('hover:bg-slate-50', onSelect && 'cursor-pointer')}
      onClick={onSelect ? () => onSelect(row) : undefined}
    >
      <td className="py-2 px-4 w-8">
        {afgerond ? (
          <CheckCircle2 size={18} className="text-emerald-600" aria-label="Afgerond" />
        ) : gesneden ? (
          <CheckCircle2 size={18} className="text-emerald-500" aria-label="Gesneden — klaar voor confectie" />
        ) : (
          <Circle size={18} className="text-slate-300" aria-label="Nog niet gesneden" />
        )}
      </td>
      <td className="py-2 px-2 font-medium tabular-nums whitespace-nowrap">
        {row.lengte_cm ?? '?'}×{row.breedte_cm ?? '?'} cm
      </td>
      <td className="py-2 px-2 text-slate-700 whitespace-nowrap">
        {row.kwaliteit_code} {row.kleur_code}
      </td>
      <td className="py-2 px-2">
        {row.rolnummer && row.rol_id ? (
          <Link
            to={`/snijplanning/productie/${row.rol_id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-terracotta-600 hover:underline text-xs tabular-nums"
          >
            {row.rolnummer}
          </Link>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="py-2 px-2 text-slate-700 truncate max-w-[200px]">{row.klant_naam}</td>
      <td className="py-2 px-2">
        <Link
          to={`/orders/${row.order_id}`}
          onClick={(e) => e.stopPropagation()}
          className="text-terracotta-600 hover:underline text-xs"
        >
          {row.order_nr}
        </Link>
      </td>
      <td className="py-2 px-2 whitespace-nowrap">
        {afwMap ? (
          <span className={cn('text-xs px-2 py-0.5 rounded-full', afwMap.bg, afwMap.text)}>{row.maatwerk_afwerking}</span>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </td>
      <td className="py-2 px-2 whitespace-nowrap tabular-nums">
        {deadline ? (
          <span className={cn('inline-flex items-center gap-1', teLaat ? 'text-red-700 font-medium' : 'text-slate-700')}>
            {teLaat && <AlertTriangle size={12} />}
            vr {fmtDeadline(deadline)}
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
    </tr>
  )
}
