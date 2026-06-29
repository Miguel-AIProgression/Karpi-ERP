import { Lock, Zap, Link2, Unlink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils/cn'
import { AFWERKING_MAP } from '@/lib/utils/constants'
import { HAALBAARHEID_STATUS_STYLE } from '@/lib/orders/haalbaarheid-status-badge'
import { getVormDisplay } from '@/lib/utils/vorm-labels'
import type { WerklijstOrderregel } from '@/modules/snijplanning/lib/werklijst-groepering'

function formatVerzendweek(week: string | null): string {
  if (!week) return '—'
  const m = week.match(/^(\d{4})-W(\d{1,2})$/)
  if (!m) return week
  return `Wk ${parseInt(m[2])}/${m[1].slice(2)}`
}

interface Props {
  regel: WerklijstOrderregel
  /** Fase (c): callback voor IO-koppeling. Geeft een knop als aanwezig. */
  onKoppelClick?: () => void
}

export function WerklijstOrderregelRij({ regel, onKoppelClick }: Props) {
  const afwerking = regel.maatwerk_afwerking ? AFWERKING_MAP[regel.maatwerk_afwerking] : null
  const vorm = getVormDisplay(regel.maatwerk_vorm)
  const toonVorm = regel.maatwerk_vorm && regel.maatwerk_vorm !== 'rechthoek'
  const haalbaarheid = regel.haalbaarheid ? HAALBAARHEID_STATUS_STYLE[regel.haalbaarheid] : null

  return (
    <tr className="text-sm border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
      {/* Formaat + stuks */}
      <td className="py-2 pl-3 pr-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {regel.express && (
            <span className="inline-flex items-center gap-0.5 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
              <Zap size={10} />
              Express
            </span>
          )}
          <span className="font-mono text-xs text-slate-800">
            {regel.maatwerk_lengte_cm ?? '?'}×{regel.maatwerk_breedte_cm ?? '?'}
            <span className="text-slate-400 font-sans ml-0.5">cm</span>
          </span>
          {(regel.aantalStuks > 1) && (
            <span className="text-slate-400 text-xs">×{regel.aantalStuks}</span>
          )}
        </div>
      </td>
      {/* Afwerking */}
      <td className="py-2 pr-2">
        {afwerking && (
          <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', afwerking.bg, afwerking.text)}>
            {afwerking.label}
          </span>
        )}
      </td>
      {/* Vorm */}
      <td className="py-2 pr-2">
        {toonVorm && (
          <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', vorm.bg, vorm.text)}>
            {vorm.kort}
          </span>
        )}
      </td>
      {/* Order + klant */}
      <td className="py-2 pr-2 min-w-[80px]">
        <Link
          to={`/orders/${regel.orderNr}`}
          className="text-xs text-terracotta-600 hover:underline tabular-nums"
          onClick={(e) => e.stopPropagation()}
        >
          {regel.orderNr}
        </Link>
      </td>
      <td className="py-2 pr-2 text-slate-800 min-w-[120px] text-xs">
        {regel.klantNaam}
      </td>
      {/* Verzendweek */}
      <td className="py-2 pr-2">
        <span className="text-xs text-slate-600 tabular-nums whitespace-nowrap">
          {formatVerzendweek(regel.verzendweek)}
        </span>
      </td>
      {/* Haalbaarheid + lock + IO-koppel-knop */}
      <td className="py-2 pr-3">
        <div className="flex items-center gap-1 justify-end">
          {regel.is_handmatig_toegewezen && (
            <Lock size={12} className="text-slate-400 shrink-0" aria-label="Handmatig vergrendeld" />
          )}
          {haalbaarheid && (
            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', haalbaarheid.bg, haalbaarheid.text)}>
              {haalbaarheid.label}
            </span>
          )}
          {/* Fase (c): IO-koppelknop voor tekort en wacht-op-inkoop */}
          {onKoppelClick && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onKoppelClick() }}
              title={regel.materiaalStatus === 'wacht_op_inkoop' ? 'IO-koppeling wijzigen' : 'Koppel aan inkooporder'}
              className={cn(
                'rounded p-1 transition-colors',
                regel.materiaalStatus === 'wacht_op_inkoop'
                  ? 'text-blue-400 hover:bg-blue-50 hover:text-blue-600'
                  : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
              )}
            >
              {regel.materiaalStatus === 'wacht_op_inkoop' ? (
                <Unlink size={12} />
              ) : (
                <Link2 size={12} />
              )}
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
