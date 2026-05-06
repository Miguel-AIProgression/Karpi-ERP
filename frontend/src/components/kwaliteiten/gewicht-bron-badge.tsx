import { cn } from '@/lib/utils/cn'

interface GewichtBronBadgeProps {
  gewichtUitKwaliteit: boolean
  className?: string
}

/**
 * Toont alleen iets als gewicht NIET uit kwaliteit-bron komt.
 * Migratie-zichtbaarheid: producten zonder kwaliteit-density vallen terug op
 * legacy `producten.gewicht_kg`. Verdwijnt zodra Piet-Hein de Excel-import
 * heeft toegepast en alle relevante kwaliteiten een gewicht hebben.
 */
export function GewichtBronBadge({ gewichtUitKwaliteit, className }: GewichtBronBadgeProps) {
  if (gewichtUitKwaliteit) return null
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        'bg-amber-100 text-amber-700',
        className
      )}
      title="Gewicht uit oude bron — kwaliteit heeft nog geen gewicht/m² ingevuld."
    >
      uit oude bron
    </span>
  )
}
