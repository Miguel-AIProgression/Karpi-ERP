// Compacte bundel-info-strip die boven of onder een KlantCluster wordt
// gerenderd: toont vervoerder + adres-snippet + drempel-progressbar +
// besparing-badge.
//
// Bron: `voorgestelde_zending_bundels`-view (mig 229), gefetcht via
// `useVoorgesteldeBundels` op week-niveau in pick-overview. Per cluster wordt
// hier een gevonden bundel-rij doorgegeven; als de match ontbreekt, rendert
// het component niets (clusters die geen voorgestelde-bundel hebben — bv.
// orders zonder afleverdatum — blijven 'gewoon' getoond).
import { Truck, TrendingDown } from 'lucide-react'
import { DrempelProgressBar } from './drempel-progressbar'
import { formatCurrency } from '@/lib/utils/formatters'
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
    <div className="rounded-md border border-terracotta-300/60 bg-white/80 px-3 py-2 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-slate-600 min-w-0">
          <span className="inline-flex items-center gap-1 font-medium text-slate-800">
            <Truck size={12} className="text-slate-500" aria-hidden />
            {vervoerderLabel}
          </span>
          <span className="text-slate-400" aria-hidden>·</span>
          <span className="truncate">
            {bundel.afl_postcode ?? '—'} {bundel.afl_plaats ?? ''}
          </span>
        </div>
        {bundel.bundel_besparing > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-700"
            title="Bespaarde verzendkosten t.o.v. solo-verzending per order"
          >
            <TrendingDown size={11} aria-hidden />
            Bespaart {formatCurrency(bundel.bundel_besparing)}
          </span>
        )}
      </div>
      <DrempelProgressBar
        subtotaal={bundel.bundel_subtotaal_excl}
        drempel={bundel.klant_drempel}
        drempelGehaald={bundel.drempel_gehaald}
        gratisVerzending={bundel.gratis_verzending}
        verzendkosten={bundel.klant_verzendkosten}
      />
    </div>
  )
}
