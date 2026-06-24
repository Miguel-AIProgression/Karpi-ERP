import { cn } from '@/lib/utils/cn'
import type { ZendingStatus } from '@/modules/logistiek/queries/zendingen'

const STATUS_KLEUREN: Record<ZendingStatus, { bg: string; text: string }> = {
  Gepland:                  { bg: 'bg-slate-100',   text: 'text-slate-700' },
  Picken:                   { bg: 'bg-amber-100',   text: 'text-amber-700' },
  Ingepakt:                 { bg: 'bg-blue-100',    text: 'text-blue-700' },
  'Klaar voor verzending':  { bg: 'bg-indigo-100',  text: 'text-indigo-700' },
  Onderweg:                 { bg: 'bg-cyan-100',    text: 'text-cyan-700' },
  Afgeleverd:               { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  Afgehaald:                { bg: 'bg-teal-100',    text: 'text-teal-700' },
}

// Weergave-label per status. De DB-enum-waarde blijft 'Onderweg', maar we tonen
// 'Verzonden': HST/Rhenus geven (nog) géén bezorgbevestiging terug, dus we weten
// alleen dat de zending succesvol is aangemeld/verstuurd — niet dat-ie onderweg
// of geleverd is. 'Verzonden' is daarmee eerlijker dan 'Onderweg'. Zodra er een
// echte T&T-/delivery-terugkoppeling is, kan dit label weer 'Onderweg' worden.
const STATUS_LABELS: Partial<Record<ZendingStatus, string>> = {
  Onderweg: 'Verzonden',
}

export function zendingStatusLabel(status: ZendingStatus | string): string {
  return STATUS_LABELS[status as ZendingStatus] ?? status
}

interface ZendingStatusBadgeProps {
  status: ZendingStatus | string
  className?: string
  /** Overschrijft de getoonde tekst (niet de kleur). Bv. 'Aangemeld' voor een
   *  zending die op zijn dagbatch wacht (mig 484) — de echte status blijft
   *  'Klaar voor verzending', alleen de weergave wijkt af. */
  label?: string
}

export function ZendingStatusBadge({ status, className, label }: ZendingStatusBadgeProps) {
  const kleur = STATUS_KLEUREN[status as ZendingStatus] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        kleur.bg,
        kleur.text,
        className,
      )}
    >
      {label ?? zendingStatusLabel(status)}
    </span>
  )
}
