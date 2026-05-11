// Compacte info-strook voor een al gestarte bundel-pickronde: toont het
// zending-nummer + adres-snippet, zelfde visuele plek als
// `VoorgesteldeBundelInfo` zodat de wrapper-styling visueel continu blijft
// pre- en post-pickronde-start.
//
// Bewust geen vervoerder / besparing / drempel-info — die zijn:
// - Vervoerder: al zichtbaar per orderregel-card eronder.
// - Besparing / drempel: commerciële info, hoort niet in Pick & Ship
//   (matched in CLAUDE.md “drempel-progressbar geen picker-info”).
import { Truck } from 'lucide-react'

interface Props {
  zendingNr: string
  postcode: string | null
  plaats: string | null
}

export function ActieveBundelInfo({ zendingNr, postcode, plaats }: Props) {
  const adres = [postcode, plaats].filter((p) => p && p.trim().length > 0).join(' · ')
  return (
    <div className="rounded-md border border-terracotta-300/60 bg-white/80 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 font-medium text-slate-800">
          <Truck size={12} className="text-slate-500" aria-hidden />
          {zendingNr}
        </span>
        {adres && (
          <>
            <span className="text-slate-400" aria-hidden>·</span>
            <span className="truncate text-slate-600">{adres}</span>
          </>
        )}
      </div>
    </div>
  )
}
