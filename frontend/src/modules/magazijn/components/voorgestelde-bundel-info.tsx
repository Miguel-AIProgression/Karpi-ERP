// Compacte bundel-info-strip die boven of onder een KlantCluster wordt
// gerenderd: toont vervoerder + adres-snippet.
//
// **Pick-context, geen commerciële info.** De pickers willen alleen weten
// "deze orders gaan straks samen via X naar Y" — geen drempel-progressbar,
// geen bespaar-badge. De `bundel_besparing` uit `voorgestelde_zending_bundels`
// blijft beschikbaar voor factuur-/dashboard-modules; Pick & Ship gebruikt 'm
// expliciet niet.
//
// Bron: `voorgestelde_zending_bundels`-view (mig 229), gefetcht via
// `useVoorgesteldeBundels` op week-niveau in pick-overview. Per cluster wordt
// hier een gevonden bundel-rij doorgegeven; als de match ontbreekt, rendert
// het component niets.
import { Truck } from 'lucide-react'
import type { VoorgesteldeBundel } from '@/modules/logistiek/queries/voorgestelde-bundels'

interface Props {
  bundel: VoorgesteldeBundel
}

export function VoorgesteldeBundelInfo({ bundel }: Props) {
  const vervoerderLabel = bundel.is_afhalen
    ? 'Afhalen'
    : bundel.vervoerder_code === 'GEEN'
      ? 'Geen vervoerder'
      : bundel.vervoerder_code

  return (
    <div className="rounded-md border border-terracotta-300/60 bg-white/80 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 min-w-0">
        <span className="inline-flex items-center gap-1 font-medium text-slate-800">
          <Truck size={12} className="text-slate-500" aria-hidden />
          {vervoerderLabel}
        </span>
        <span className="text-slate-400" aria-hidden>·</span>
        <span className="truncate">
          {bundel.afl_postcode ?? '—'} {bundel.afl_plaats ?? ''}
        </span>
      </div>
    </div>
  )
}
