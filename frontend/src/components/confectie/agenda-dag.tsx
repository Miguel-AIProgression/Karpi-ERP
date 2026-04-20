import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { LaneBlok, Werktijden } from '@/lib/utils/bereken-agenda'
import type { ConfectiePlanningRow } from '@/lib/supabase/queries/confectie-planning'
import { confectieDeadline } from '@/lib/utils/confectie-deadline'

const PX_PER_MIN = 1.6  // 1 min = 1.6px → uur = 96px

const DAG_NAMEN = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag']
const MAAND_KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

function parseHHmm(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function fmtDag(d: Date): string {
  return `${DAG_NAMEN[d.getDay()]} ${d.getDate()} ${MAAND_KORT[d.getMonth()]}`
}

function fmtTijd(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function zelfdeDag(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export interface LaneBlokkenMap {
  type: string
  blokken: LaneBlok<ConfectiePlanningRow>[]
}

interface Props {
  datum: Date
  lanes: LaneBlokkenMap[]
  werktijden: Werktijden
  onSelect?: (item: ConfectiePlanningRow) => void
}

export function AgendaDag({ datum, lanes, werktijden, onSelect }: Props) {
  const startMin = parseHHmm(werktijden.start)
  const eindMin = parseHHmm(werktijden.eind)
  const dagDuur = eindMin - startMin
  const dagHoogte = dagDuur * PX_PER_MIN

  const pauzeStart = parseHHmm(werktijden.pauzeStart)
  const pauzeEind = parseHHmm(werktijden.pauzeEind)
  const heeftPauze = werktijden.pauzeStart && werktijden.pauzeEind && werktijden.pauzeStart !== werktijden.pauzeEind

  // Filter blokken per lane die (starten) op deze dag
  const lanesMetBlokken = lanes.map(({ type, blokken }) => ({
    type,
    blokken: blokken.filter((b) => zelfdeDag(b.start, datum)),
  }))

  const totaalStuks = lanesMetBlokken.reduce((s, l) => s + l.blokken.length, 0)
  if (totaalStuks === 0) return null

  // Uur-labels
  const urenLabels: number[] = []
  for (let u = Math.floor(startMin / 60); u <= Math.ceil(eindMin / 60); u++) urenLabels.push(u)

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-900">{fmtDag(datum)}</span>
        <span className="text-xs text-slate-500 tabular-nums">{totaalStuks} stuks</span>
      </div>

      <div className="flex">
        {/* Tijd-as */}
        <div className="w-14 shrink-0 border-r border-slate-200 relative" style={{ height: dagHoogte }}>
          {urenLabels.map((u) => {
            const top = (u * 60 - startMin) * PX_PER_MIN
            return (
              <div
                key={u}
                className="absolute left-0 right-0 text-[10px] text-slate-400 tabular-nums px-2 -translate-y-1/2"
                style={{ top }}
              >
                {String(u).padStart(2, '0')}:00
              </div>
            )
          })}
        </div>

        {/* Lanes-grid */}
        <div className="flex-1 flex relative" style={{ height: dagHoogte }}>
          {/* Horizontale uurlijnen */}
          {urenLabels.map((u) => {
            const top = (u * 60 - startMin) * PX_PER_MIN
            return <div key={u} className="absolute left-0 right-0 border-t border-slate-100" style={{ top }} />
          })}

          {/* Pauze-band */}
          {heeftPauze && pauzeStart >= startMin && pauzeEind <= eindMin && (
            <div
              className="absolute left-0 right-0 bg-slate-50 border-y border-dashed border-slate-200 flex items-center justify-center pointer-events-none"
              style={{
                top: (pauzeStart - startMin) * PX_PER_MIN,
                height: (pauzeEind - pauzeStart) * PX_PER_MIN,
              }}
            >
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">Pauze</span>
            </div>
          )}

          {lanesMetBlokken.map(({ type, blokken }, i) => (
            <div key={type} className={cn('flex-1 relative min-w-0', i > 0 && 'border-l border-slate-200')}>
              <div className="absolute inset-x-0 top-0 px-2 py-1 text-[11px] font-medium text-slate-600 capitalize bg-white/90 backdrop-blur border-b border-slate-200 z-10 truncate">
                {type} ({blokken.length})
              </div>
              {blokken.map((blok) => {
                const startTotaalMin = blok.start.getHours() * 60 + blok.start.getMinutes()
                const eindTotaalMin = blok.eind.getHours() * 60 + blok.eind.getMinutes() + (zelfdeDag(blok.start, blok.eind) ? 0 : 24 * 60)
                const top = Math.max(0, (startTotaalMin - startMin) * PX_PER_MIN)
                const hoogte = Math.max(24, (eindTotaalMin - startTotaalMin) * PX_PER_MIN)
                return (
                  <AgendaBlok
                    key={blok.item.confectie_id}
                    blok={blok}
                    top={top}
                    hoogte={hoogte}
                    onClick={onSelect ? () => onSelect(blok.item) : undefined}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface BlokProps {
  blok: LaneBlok<ConfectiePlanningRow>
  top: number
  hoogte: number
  onClick?: () => void
}

function AgendaBlok({ blok, top, hoogte, onClick }: BlokProps) {
  const { item, start, eind } = blok
  const deadline = confectieDeadline(item.afleverdatum)
  const teLaat = !!deadline && eind > deadline
  const afgerond = !!item.confectie_afgerond_op
  const compact = hoogte < 50

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      className={cn(
        'absolute left-0.5 right-0.5 rounded-[var(--radius-sm)] border overflow-hidden text-xs transition-colors',
        onClick && 'cursor-pointer',
        teLaat
          ? 'bg-red-50 border-red-300 hover:bg-red-100'
          : afgerond
            ? 'bg-emerald-50 border-emerald-300 hover:bg-emerald-100'
            : 'bg-terracotta-50 border-terracotta-200 hover:bg-terracotta-100',
      )}
      style={{ top: `${top + 28}px`, height: `${hoogte}px` }}
      title={`${fmtTijd(start)} → ${fmtTijd(eind)} · ${item.klant_naam} · ${item.order_nr}`}
    >
      <div className="px-1.5 py-0.5 leading-tight">
        <div className="flex items-center gap-1 tabular-nums font-medium text-slate-800 truncate">
          {afgerond && <CheckCircle2 size={10} className="text-emerald-600 shrink-0" />}
          {teLaat && <AlertTriangle size={10} className="text-red-600 shrink-0" />}
          <span>{fmtTijd(start)}</span>
          <span className="text-slate-400">–</span>
          <span>{fmtTijd(eind)}</span>
        </div>
        {!compact && (
          <>
            <div className="text-slate-800 tabular-nums truncate">
              {item.lengte_cm ?? '?'}×{item.breedte_cm ?? '?'} cm
            </div>
            <div className="text-slate-600 truncate">{item.klant_naam}</div>
            <div className="truncate">
              <Link
                to={`/orders/${item.order_id}`}
                onClick={(e) => e.stopPropagation()}
                className="text-terracotta-700 hover:underline"
              >
                {item.order_nr}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
