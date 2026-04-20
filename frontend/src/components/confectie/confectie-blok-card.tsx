import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { confectieDeadline } from '@/lib/utils/confectie-deadline'
import type { LaneBlok } from '@/lib/utils/bereken-agenda'
import type { ConfectiePlanningRow } from '@/lib/supabase/queries/confectie-planning'

function fmtDagKort(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const DAG_KORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']

function fmtTijd(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "Ma 08:15" — of "vandaag 08:15" als dag == vandaag. */
function fmtStart(d: Date): string {
  const nu = new Date()
  const zelfdeDag = d.getDate() === nu.getDate() && d.getMonth() === nu.getMonth() && d.getFullYear() === nu.getFullYear()
  if (zelfdeDag) return `vandaag ${fmtTijd(d)}`
  return `${DAG_KORT[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')} ${fmtTijd(d)}`
}

interface Props {
  blok: LaneBlok<ConfectiePlanningRow>
  onClick?: () => void
}

export function ConfectieBlokCard({ blok, onClick }: Props) {
  const { item, start, eind, duurMinuten } = blok
  const deadline = confectieDeadline(item.afleverdatum)
  const teLaat = !!deadline && eind > deadline
  const afgerond = !!item.confectie_afgerond_op

  const uren = Math.floor(duurMinuten / 60)
  const min = Math.round(duurMinuten % 60)

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      className={cn(
        'rounded-[var(--radius-sm)] border p-3 text-sm transition-colors',
        onClick && 'cursor-pointer',
        teLaat ? 'border-red-300 bg-red-50 hover:bg-red-100' : 'border-slate-200 bg-white hover:bg-slate-50',
        afgerond && !teLaat && 'border-emerald-300 bg-emerald-50/60 hover:bg-emerald-50',
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-medium tabular-nums flex items-center gap-1.5">
          {afgerond && <CheckCircle2 size={13} className="text-emerald-600" />}
          {item.lengte_cm ?? '?'}×{item.breedte_cm ?? '?'} cm
        </span>
        <span className="text-xs text-slate-500 tabular-nums">
          {uren > 0 ? `${uren}u ` : ''}{min}m
        </span>
      </div>
      <div className="text-xs text-slate-700 tabular-nums mb-1">
        Start: <span className="font-medium">{fmtStart(start)}</span>
        <span className="text-slate-400"> → {fmtTijd(eind)}</span>
      </div>
      <div className="text-xs text-slate-600 truncate">{item.klant_naam}</div>
      <div className="text-xs">
        <Link to={`/orders/${item.order_id}`} onClick={(e) => e.stopPropagation()} className="text-terracotta-600 hover:underline">
          {item.order_nr}
        </Link>
        <span className="text-slate-400"> · {item.confectie_nr}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs">
        {item.rolnummer ? (
          item.rol_id ? (
            <Link
              to={`/snijplanning/productie/${item.rol_id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-terracotta-600 hover:underline tabular-nums"
            >
              {item.rolnummer}
            </Link>
          ) : (
            <span className="text-slate-500 tabular-nums">{item.rolnummer}</span>
          )
        ) : (
          <span className="text-slate-300">—</span>
        )}
        {deadline && (
          <span className={cn(
            'inline-flex items-center gap-1 font-medium tabular-nums',
            teLaat ? 'text-red-700' : 'text-slate-700',
          )}>
            {teLaat && <AlertTriangle size={11} />}
            vr {fmtDagKort(deadline)}
          </span>
        )}
      </div>
    </div>
  )
}
