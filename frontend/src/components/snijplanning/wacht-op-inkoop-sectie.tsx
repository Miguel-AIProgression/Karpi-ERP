import { Truck } from 'lucide-react'
import { formatDate, formatNumber } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import type { WachtOpInkoopRow } from '@/modules/snijplanning'

// Mig 437/438/440: stukken die geen fysieke rol vonden, maar door auto-plan-
// groep's tweede pas (virtuele rol, in-memory) gekoppeld zijn aan een
// openstaande rol-inkooporder. Eigen sectie i.p.v. hergebruik van
// GroepAccordion — die is gebonden aan snijplanning_overzicht/TE_SNIJDEN en
// status='Wacht op inkoop' valt daar bewust buiten (zie migratie 439/het
// plan: zo verdwijnt een geclaimde groep automatisch uit Tekort).
//
// Kleur (oranje) spiegelt de bestaande order-status "Wacht op inkoop"
// (frontend/src/lib/utils/constants.ts) — zelfde concept, andere laag.

interface WachtOpInkoopSectieProps {
  kwaliteitCode: string
  kleurCode: string
  regels: WachtOpInkoopRow[]
}

export function WachtOpInkoopSectie({ kwaliteitCode, kleurCode, regels }: WachtOpInkoopSectieProps) {
  const kleurLabel = kleurCode.replace(/\.0$/, '')
  const totaalStukken = regels.reduce((s, r) => s + r.aantal_stukken, 0)

  return (
    <div className="rounded-[var(--radius-sm)] border border-orange-200 bg-orange-50 overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 flex-wrap text-xs font-medium text-orange-800">
        <Truck size={14} className="flex-shrink-0" />
        <span className="text-sm font-semibold text-slate-900">
          {kwaliteitCode} {kleurLabel}
        </span>
        <span>
          · {totaalStukken} {totaalStukken === 1 ? 'stuk' : 'stukken'} wacht op inkoop
        </span>
      </div>
      <div className="divide-y divide-orange-100 bg-white">
        {regels.map((r) => (
          <div key={r.inkooporder_regel_id} className="px-3 py-2 text-sm flex items-center gap-2 flex-wrap">
            <span className={cn('text-xs px-1.5 py-0.5 rounded', 'bg-orange-100 text-orange-700')}>
              Wacht op inkoop
            </span>
            <span className="text-slate-700">
              Onderweg via <span className="font-medium">{r.inkooporder_nr}</span>
              {r.leverancier_naam ? ` (${r.leverancier_naam})` : ''}
            </span>
            <span className="text-slate-500">
              {formatNumber(r.te_leveren_m, 0)} m verwacht
              {r.verwacht_datum ? ` ${formatDate(r.verwacht_datum)}` : ''}
            </span>
            <span className="ml-auto text-slate-500 tabular-nums">
              {formatNumber(r.gebruikte_lengte_cm / 100, 1)} m gebruikt · {formatNumber(r.resterend_m2, 1)} m² resterend
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
              {r.aantal_stukken} {r.aantal_stukken === 1 ? 'stuk' : 'stukken'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
