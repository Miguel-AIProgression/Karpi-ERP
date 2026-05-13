import { useInkoopRegelSamenvatting } from '../hooks/use-inkooporders'
import { verzendWeekKort } from '@/lib/orders/verzendweek'

interface Props {
  ioRegelId: number
}

/**
 * Slot voor Reservering's `<RegelClaimDetail>` (en andere consumers buiten Inkoop).
 *
 * Self-fetcht: één query haalt regel + parent-IO + leverancier op. De consumer
 * geeft alleen `ioRegelId` door en hoeft niets te weten over Inkoop's data-shape.
 * Inkoop is dus volledig vrij om interne types te wijzigen zonder dat externe
 * pagina's breken.
 */
export function InkoopRegelSamenvatting({ ioRegelId }: Props) {
  const { data, isLoading } = useInkoopRegelSamenvatting(ioRegelId)

  if (isLoading) {
    return <span className="text-xs text-slate-400">…</span>
  }
  if (!data) return null

  return (
    <div className="text-xs space-y-0.5">
      <div className="font-medium">
        {data.inkooporder_nr}
        {data.leverancier_naam && (
          <span className="text-slate-500"> · {data.leverancier_naam}</span>
        )}
      </div>
      <div className="flex items-center gap-2 text-slate-600">
        <span className="inline-flex px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-medium">
          {data.inkooporder_status}
        </span>
        {data.verwacht_datum && (
          <span>verwacht {verzendWeekKort(data.verwacht_datum)}</span>
        )}
        {data.te_leveren_m > 0 && (
          <span>
            {data.te_leveren_m} {data.eenheid === 'stuks' ? 'stuks' : 'm'} open
          </span>
        )}
      </div>
    </div>
  )
}
