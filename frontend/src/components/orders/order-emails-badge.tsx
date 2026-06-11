import type { VerstuurdeEmail } from '@/lib/supabase/queries/verstuurde-emails'

const SOORT_STYLE: Record<VerstuurdeEmail['soort'], { label: string; className: string }> = {
  factuur: { label: 'Factuur', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  orderbevestiging: { label: 'Orderbevestiging', className: 'bg-sky-50 text-sky-700 border-sky-200' },
}

export function EmailSoortBadge({ soort }: { soort: VerstuurdeEmail['soort'] }) {
  const s = SOORT_STYLE[soort]
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border ${s.className}`}>
      {s.label}
    </span>
  )
}
