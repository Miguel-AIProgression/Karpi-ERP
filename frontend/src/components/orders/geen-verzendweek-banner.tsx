import { CalendarX } from 'lucide-react'
import { useGeenVerzendweekCount } from '@/hooks/use-orders'

/**
 * Waarschuwingsbanner: er zijn open orders zonder afleverdatum (= geen verzendweek).
 * Aanleiding: EDI-orders van SB MÖBEL BOSS / OSTERMANN kwamen binnen zonder
 * afleverdatum — ze zweefden zonder weekindeling in Pick & Ship (2026-06-24).
 * Onzichtbaar als er niets te doen valt. "Bekijk" zet het orders-filter op
 * de 'Geen verzendweek'-tab.
 */
export function GeenVerzendweekBanner({ onBekijk }: { onBekijk: () => void }) {
  const { data: aantal = 0 } = useGeenVerzendweekCount()

  if (aantal === 0) return null

  return (
    <div className="mb-4 flex items-center gap-3 rounded-[var(--radius-sm)] border border-orange-200 bg-orange-50 px-4 py-3">
      <CalendarX size={18} className="shrink-0 text-orange-600" />
      <div className="flex-1 text-sm text-orange-800">
        <span className="font-semibold">
          {aantal} {aantal === 1 ? 'order heeft' : 'orders hebben'} geen verzendweek
        </span>{' '}
        — {aantal === 1 ? 'deze order heeft' : 'deze orders hebben'} geen afleverdatum en{' '}
        {aantal === 1 ? 'verschijnt' : 'verschijnen'} zonder weekindeling in Pick &amp; Ship.
        Stel een afleverdatum in zodat {aantal === 1 ? 'de order' : 'de orders'} correct{' '}
        {aantal === 1 ? 'ingepland wordt' : 'ingepland worden'}.
      </div>
      <button
        type="button"
        onClick={onBekijk}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-orange-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-orange-700"
      >
        <CalendarX size={14} />
        Bekijk
      </button>
    </div>
  )
}
