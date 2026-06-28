import { useState } from 'react'
import { ChevronDown, ChevronRight, Ruler } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { WerklijstShelfVisualisatie } from './werklijst-shelf'
import { WerklijstOrderregelRij } from './werklijst-orderregel-rij'
import type { WerklijstRol } from '@/modules/snijplanning/lib/werklijst-groepering'

interface Props {
  rol: WerklijstRol
}

export function WerklijstRolSectie({ rol }: Props) {
  const [open, setOpen] = useState(true)

  const restCm = Math.round(rol.restLengteCm)
  const restKleur =
    restCm > 200
      ? 'bg-emerald-100 text-emerald-700'
      : restCm > 0
        ? 'bg-amber-100 text-amber-700'
        : 'bg-red-100 text-red-700'

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-slate-50 hover:bg-slate-100 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown size={14} className="text-slate-400 shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-slate-400 shrink-0" />
        )}
        <Ruler size={14} className="text-slate-400 shrink-0" />
        <span className="font-medium text-slate-800 text-sm">{rol.rolnummer}</span>
        <span className="text-xs text-slate-500">{rol.rolBreedteCm}cm breed</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-400 tabular-nums">
            {Math.round(rol.gebruikteLengteCm)}/{rol.rolLengteCm}cm
          </span>
          <span className={cn('text-[11px] font-medium tabular-nums px-1.5 py-0.5 rounded', restKleur)}>
            {restCm}cm rest
          </span>
        </div>
      </button>

      {open && (
        <div className="divide-y divide-slate-100">
          {/* Snijlayout visualisatie */}
          {rol.shelves.length > 0 && (
            <div className="px-4 py-3 bg-white space-y-1.5">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                Snijlayout — {rol.shelves.length}{' '}
                {rol.shelves.length === 1 ? 'doorsnede' : 'doorsnedes'}, {rol.rolBreedteCm}cm breed
              </div>
              {rol.shelves.map((shelf) => (
                <WerklijstShelfVisualisatie
                  key={shelf.positieYCm}
                  shelf={shelf}
                  rolBreedteCm={rol.rolBreedteCm}
                />
              ))}
            </div>
          )}

          {/* Orderregels */}
          <div className="bg-white">
            <table className="w-full">
              <colgroup>
                <col className="w-[160px]" />
                <col className="w-[130px]" />
                <col className="w-[70px]" />
                <col className="w-[90px]" />
                <col />
                <col className="w-[80px]" />
                <col className="w-[120px]" />
              </colgroup>
              <tbody>
                {rol.orderregels.map((regel) => (
                  <WerklijstOrderregelRij key={regel.orderRegelId} regel={regel} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
