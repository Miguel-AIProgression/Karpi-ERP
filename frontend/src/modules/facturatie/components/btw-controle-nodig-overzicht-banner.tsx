import { Globe2 } from 'lucide-react'
import { useBtwControleNodigCount } from '../hooks/use-facturen'

/**
 * Waarschuwingsbanner op /facturatie: er zijn facturen waarvoor
 * bepaal_btw_regeling (mig 455/456) een afwijkende of onzekere BTW-regeling
 * signaleerde (afwijkend EU-afleverland, export buiten de EU, of EU-ICL zonder
 * btw-nummer). Onzichtbaar als er niets te controleren is. Patroon: EdiTeKoppelenBanner.
 */
export function BtwControleNodigOverzichtBanner({ onBekijk }: { onBekijk: () => void }) {
  const { data: aantal = 0 } = useBtwControleNodigCount()

  if (aantal === 0) return null

  return (
    <div className="mb-4 flex items-center gap-3 rounded-[var(--radius-sm)] border border-amber-200 bg-amber-50 px-4 py-3">
      <Globe2 size={18} className="shrink-0 text-amber-600" />
      <div className="flex-1 text-sm text-amber-800">
        <span className="font-semibold">
          {aantal} {aantal === 1 ? 'factuur heeft' : 'facturen hebben'} BTW controle nodig
        </span>{' '}
        — afwijkend afleverland, export buiten de EU, of EU-levering zonder btw-nummer.
      </div>
      <button
        onClick={onBekijk}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-700"
      >
        Bekijk
      </button>
    </div>
  )
}
