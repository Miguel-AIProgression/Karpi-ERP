import type { OrderRegelLevertijd, LevertijdStatus } from '@/lib/supabase/queries/reserveringen'

const STYLE: Record<LevertijdStatus, string> = {
  voorraad: 'bg-emerald-50 text-emerald-700',
  op_inkoop: 'bg-amber-50 text-amber-700',
  wacht_op_nieuwe_inkoop: 'bg-rose-50 text-rose-700',
  maatwerk: 'bg-violet-50 text-violet-700',
}

function label(l: OrderRegelLevertijd): string {
  switch (l.levertijd_status) {
    case 'voorraad': return 'Voorraad'
    case 'op_inkoop': return l.verwachte_leverweek ?? 'Inkoop'
    case 'wacht_op_nieuwe_inkoop': return 'Wacht op inkoop'
    case 'maatwerk': return 'Maatwerk'
  }
}

export function LevertijdBadge({ levertijd }: { levertijd: OrderRegelLevertijd }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STYLE[levertijd.levertijd_status]}`}>
      {label(levertijd)}
    </span>
  )
}
