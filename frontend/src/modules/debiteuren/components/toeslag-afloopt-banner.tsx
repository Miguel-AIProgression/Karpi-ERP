import { AlertTriangle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useToeslagAflooptCount } from '../hooks/use-toeslag-afloopt'

/**
 * Waarschuwingsbanner: er zijn klanten met een toeslag die binnen 31 dagen afloopt.
 * Onzichtbaar als er niets afloopt. Patroon: BtwControleNodigOverzichtBanner.
 */
export function ToeslagAflooptBanner() {
  const { data: debiteuren = [] } = useToeslagAflooptCount()
  const navigate = useNavigate()

  if (debiteuren.length === 0) return null

  return (
    <div className="mb-4 flex items-center gap-3 rounded-[var(--radius-sm)] border border-amber-200 bg-amber-50 px-4 py-3">
      <AlertTriangle size={18} className="shrink-0 text-amber-600" />
      <div className="flex-1 text-sm text-amber-800">
        <span className="font-semibold">
          Toeslag loopt binnenkort af
        </span>{' '}
        — {debiteuren.length === 1
          ? `${debiteuren[0].naam} (${debiteuren[0].einddatum_formatted})`
          : `${debiteuren.length} klanten hebben een toeslag die binnen 31 dagen afloopt`
        }
      </div>
      <button
        onClick={() => navigate(`/klanten/${debiteuren[0].debiteur_nr}?tab=facturering`)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-700"
      >
        Bekijk
      </button>
    </div>
  )
}
