import type { InkooporderStatus } from '@/lib/supabase/queries/inkooporders'

const STYLES: Record<InkooporderStatus, string> = {
  Concept: 'bg-slate-100 text-slate-600',
  Besteld: 'bg-blue-50 text-blue-700',
  'Deels ontvangen': 'bg-amber-50 text-amber-700',
  Ontvangen: 'bg-emerald-50 text-emerald-700',
  Geannuleerd: 'bg-red-50 text-red-700',
}

export function InkooporderStatusBadge({ status }: { status: InkooporderStatus }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STYLES[status]}`}>
      {status}
    </span>
  )
}
