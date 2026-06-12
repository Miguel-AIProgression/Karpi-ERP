import { Link } from 'react-router-dom'
import { AlertTriangle, Truck } from 'lucide-react'
import { useHstMonitor, useOrdersZonderVervoerder } from '@/modules/logistiek/hooks/use-hst-monitor'
import { telHstAandacht } from '@/modules/logistiek/queries/hst-monitor'

/**
 * Proactieve waarschuwing op Pick & Ship: open HST-fouten / stilstaande cron, én
 * orders die handmatig een vervoerder nodig hebben (buiten HST-bereik). Onzichtbaar
 * als er niets aan de hand is. Spiegelt EdiTeKoppelenBanner.
 */
export function HstAandachtBanner() {
  const { data: m } = useHstMonitor()
  const { data: zv } = useOrdersZonderVervoerder()
  const aandacht = m ? telHstAandacht(m) : 0

  if (aandacht === 0 && (zv?.totaal ?? 0) === 0) return null

  const perLandTekst = zv?.perLand.map((l) => `${l.aantal}× ${l.land}`).join(', ')

  return (
    <div className="mb-4 space-y-2">
      {aandacht > 0 && (
        <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-rose-200 bg-rose-50 px-4 py-3">
          <AlertTriangle size={18} className="shrink-0 text-rose-600" />
          <div className="flex-1 text-sm text-rose-800">
            <span className="font-semibold">{m?.fout_open ?? 0} HST-verzendfout(en)</span>
            {m && (m.oudste_wachtrij_minuten > 5 || m.oudste_bezig_minuten > 5) ? ' — en de verzend-cron loopt achter.' : ' — bekijk en verstuur opnieuw.'}
          </div>
          <Link to="/logistiek/vervoerders/hst_api/monitor" className="shrink-0 rounded-[var(--radius-sm)] bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700">
            Bekijk
          </Link>
        </div>
      )}
      {zv && zv.totaal > 0 && (
        <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-amber-200 bg-amber-50 px-4 py-3">
          <Truck size={18} className="shrink-0 text-amber-600" />
          <div className="flex-1 text-sm text-amber-800">
            <span className="font-semibold">{zv.totaal} open order(s) zonder vervoerder</span>
            {perLandTekst ? <> — {perLandTekst}</> : null}
            {zv.klaarVoorPicken !== null ? <> · waarvan {zv.klaarVoorPicken} klaar voor picken</> : null}
            <div className="mt-0.5 text-xs text-amber-700">
              Geteld over álle open orders, ook orders die hier (nog) niet zichtbaar zijn. Voor deze landen matcht
              geen actieve vervoerder — kies handmatig een vervoerder op de order, of activeer de vervoerder voor
              dat land.
            </div>
          </div>
          <Link
            to="/logistiek/vervoerders"
            className="shrink-0 rounded-[var(--radius-sm)] bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
          >
            Vervoerders
          </Link>
        </div>
      )}
    </div>
  )
}
