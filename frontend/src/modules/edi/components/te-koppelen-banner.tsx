import { Link } from 'react-router-dom'
import { AlertTriangle, Link2 } from 'lucide-react'
import { useTeKoppelenEdiCount } from '@/modules/edi/hooks/use-edi'

/**
 * Waarschuwingsbanner: er zijn inkomende EDI-orders die niet automatisch aan een
 * klant gekoppeld konden worden (geen GLN-match) en dus géén order werden.
 *
 * Plaatst dit signaal in de Orders-module — waar de operator werkt — zodat zo'n
 * gemiste order nooit tussen wal en schip valt. Onzichtbaar als er niets te
 * koppelen valt. "Koppel nu" → de te-koppelen-lijst in de EDI-module.
 */
export function EdiTeKoppelenBanner() {
  const { data: aantal = 0 } = useTeKoppelenEdiCount()

  if (aantal === 0) return null

  return (
    <div className="mb-4 flex items-center gap-3 rounded-[var(--radius-sm)] border border-rose-200 bg-rose-50 px-4 py-3">
      <AlertTriangle size={18} className="shrink-0 text-rose-600" />
      <div className="flex-1 text-sm text-rose-800">
        <span className="font-semibold">
          {aantal} EDI-{aantal === 1 ? 'order' : 'orders'} kon{aantal === 1 ? '' : 'den'} niet aan een klant gekoppeld worden
        </span>{' '}
        — deze {aantal === 1 ? 'order is' : 'orders zijn'} binnengekomen maar nog niet verwerkt. Handel af zodat er geen order verloren gaat.
      </div>
      <Link
        to="/edi/berichten?teKoppelen=1"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-rose-700"
      >
        <Link2 size={14} />
        Koppel nu
      </Link>
    </div>
  )
}
