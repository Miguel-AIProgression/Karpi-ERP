import { cn } from '@/lib/utils/cn'
import type { ZendingStatus } from '@/modules/logistiek/queries/zendingen'

const STATUS_KLEUREN: Record<ZendingStatus, { bg: string; text: string }> = {
  Gepland:                  { bg: 'bg-slate-100',   text: 'text-slate-700' },
  Picken:                   { bg: 'bg-amber-100',   text: 'text-amber-700' },
  Ingepakt:                 { bg: 'bg-blue-100',    text: 'text-blue-700' },
  'Klaar voor verzending':  { bg: 'bg-indigo-100',  text: 'text-indigo-700' },
  Onderweg:                 { bg: 'bg-cyan-100',    text: 'text-cyan-700' },
  Afgeleverd:               { bg: 'bg-emerald-100', text: 'text-emerald-700' },
}

interface ZendingStatusBadgeProps {
  status: ZendingStatus | string
  className?: string
}

export function ZendingStatusBadge({ status, className }: ZendingStatusBadgeProps) {
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
      {status}
    </span>
  )
}
