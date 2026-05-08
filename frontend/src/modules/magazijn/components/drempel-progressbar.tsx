// Visualiseert hoe dicht een bundel-totaal bij de gratis-verzending-drempel zit.
// Drie staten:
//   1. drempel_gehaald=true → volle teal-balk + "Gratis verzending"-label
//   2. drempel < ½ gehaald → smal, slate
//   3. drempel ≥ ½ gehaald → amber (bijna gratis, motiveer operator om bij te
//      bundelen)
//
// De progressbar werkt zowel in een reguliere kaart als in compacte
// klant-cluster-headers, dankzij het 1-regelige layout en geen vaste hoogte.
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/formatters'

interface Props {
  /** Subtotaal exclusief BTW (€). */
  subtotaal: number
  /** Drempel boven welke verzending gratis is. NULL = geen drempel ingesteld. */
  drempel: number | null
  /** TRUE = klant heeft sowieso gratis verzending of subtotaal ≥ drempel. */
  drempelGehaald: boolean
  /** TRUE = klant heeft `gratis_verzending=TRUE` (toont andere tooltip). */
  gratisVerzending?: boolean
  /** Verzendkosten van de klant — toont besparing als drempel gehaald. */
  verzendkosten: number
  className?: string
}

export function DrempelProgressBar({
  subtotaal,
  drempel,
  drempelGehaald,
  gratisVerzending = false,
  verzendkosten,
  className,
}: Props) {
  // Bij geen drempel: minimale weergave, enkel het bedrag.
  if (drempel === null || drempel <= 0) {
    return (
      <div className={cn('text-xs text-slate-600', className)}>
        Bundel-subtotaal: {formatCurrency(subtotaal)}
      </div>
    )
  }

  const ratio = drempelGehaald ? 1 : Math.max(0, Math.min(1, subtotaal / drempel))
  const procent = Math.round(ratio * 100)
  const tekortTot = Math.max(0, drempel - subtotaal)

  // Kleur-staffel: groen (gehaald) → amber (≥50%) → slate (<50%).
  const staat: 'gehaald' | 'bijna' | 'ver' = drempelGehaald
    ? 'gehaald'
    : ratio >= 0.5
      ? 'bijna'
      : 'ver'

  const balkKleur = {
    gehaald: 'bg-teal-500',
    bijna:   'bg-amber-400',
    ver:     'bg-slate-300',
  }[staat]

  const label = drempelGehaald
    ? gratisVerzending
      ? `Gratis verzending (klantafspraak) — bespaart ${formatCurrency(verzendkosten)}`
      : `Gratis vanaf ${formatCurrency(drempel)} ✓ — bespaart ${formatCurrency(verzendkosten)}`
    : `${formatCurrency(subtotaal)} van ${formatCurrency(drempel)} — nog ${formatCurrency(tekortTot)} tot gratis`

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className={cn(
          'font-medium',
          staat === 'gehaald' && 'text-teal-700',
          staat === 'bijna'   && 'text-amber-700',
          staat === 'ver'     && 'text-slate-600',
        )}>
          {label}
        </span>
        {!drempelGehaald && (
          <span className="text-slate-400 tabular-nums">{procent}%</span>
        )}
      </div>
      <div
        className="h-1.5 rounded-full bg-slate-100 overflow-hidden"
        role="progressbar"
        aria-valuenow={procent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={cn('h-full transition-all', balkKleur)}
          style={{ width: `${procent}%` }}
        />
      </div>
    </div>
  )
}
