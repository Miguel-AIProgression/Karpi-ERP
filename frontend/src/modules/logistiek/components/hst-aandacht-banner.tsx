import { Link } from 'react-router-dom'
import { AlertTriangle, Truck } from 'lucide-react'
import { useHstMonitor, useOrdersZonderVervoerderCount } from '@/modules/logistiek/hooks/use-hst-monitor'
import { telHstAandacht } from '@/modules/logistiek/queries/hst-monitor'

/**
 * Proactieve waarschuwing op Pick & Ship: open HST-fouten / stilstaande cron, én
 * orders die handmatig een vervoerder nodig hebben (buiten HST-bereik). Onzichtbaar
 * als er niets aan de hand is. Spiegelt EdiTeKoppelenBanner.
 */
export function HstAandachtBanner() {
  const { data: m } = useHstMonitor()
  const { data: zonderVervoerder = 0 } = useOrdersZonderVervoerderCount()
  const aandacht = m ? telHstAandacht(m) : 0

  if (aandacht === 0 && zonderVervoerder === 0) return null

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
      {zonderVervoerder > 0 && (
        <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-amber-200 bg-amber-50 px-4 py-3">
          <Truck size={18} className="shrink-0 text-amber-600" />
          <div className="flex-1 text-sm text-amber-800">
            <span className="font-semibold">{zonderVervoerder} order(s) zonder vervoerder</span> — buiten HST-bereik; kies handmatig een vervoerder.
          </div>
        </div>
      )}
    </div>
  )
}
