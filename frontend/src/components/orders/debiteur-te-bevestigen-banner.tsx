import { AlertTriangle, UserCheck } from 'lucide-react'
import { useTeBevestigenDebiteurCount } from '@/hooks/use-orders'

/**
 * Waarschuwingsbanner: er zijn orders waarvan de debiteur via een onzekere
 * (fuzzy) strategie geraden is — bedrijfsnaam-deelmatch of e-mail (mig 322).
 * Analoog aan de EDI "te koppelen"-banner, maar order-niveau: de order bestaat
 * wél (gaat dus nooit verloren), maar moet aan de juiste klant bevestigd worden.
 *
 * env_fallback (verzameldebiteur, consumenten-webshop) telt bewust niet mee —
 * dat is de verwachte eindbestemming, geen fout. Onzichtbaar als er niets te
 * bevestigen valt. "Bekijk" zet het orders-filter op de te-bevestigen-lijst.
 */
export function DebiteurTeBevestigenBanner({ onBekijk }: { onBekijk: () => void }) {
  const { data: aantal = 0 } = useTeBevestigenDebiteurCount()

  if (aantal === 0) return null

  return (
    <div className="mb-4 flex items-center gap-3 rounded-[var(--radius-sm)] border border-amber-200 bg-amber-50 px-4 py-3">
      <AlertTriangle size={18} className="shrink-0 text-amber-600" />
      <div className="flex-1 text-sm text-amber-800">
        <span className="font-semibold">
          {aantal} {aantal === 1 ? 'order heeft' : 'orders hebben'} een onzekere klant-match
        </span>{' '}
        — de debiteur is automatisch geraden en moet bevestigd worden. Controleer
        en koppel zodat {aantal === 1 ? 'de order' : 'de orders'} bij de juiste klant {aantal === 1 ? 'hoort' : 'horen'}.
      </div>
      <button
        type="button"
        onClick={onBekijk}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-700"
      >
        <UserCheck size={14} />
        Bekijk
      </button>
    </div>
  )
}
