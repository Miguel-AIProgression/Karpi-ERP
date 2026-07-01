import type { VerstuurdeEmail } from '@/lib/supabase/queries/verstuurde-emails'

const SOORT_STYLE: Record<VerstuurdeEmail['soort'], { label: string; className: string }> = {
  factuur: { label: 'Factuur', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  orderbevestiging: { label: 'Orderbevestiging', className: 'bg-sky-50 text-sky-700 border-sky-200' },
}

// ponytail: pakbonmail deelt soort='factuur' (geen eigen enum-waarde) — onderscheid via onderwerp-prefix "Pakbon(nen) bij factuur ..."
const PAKBON_STYLE = { label: 'Pakbon', className: 'bg-amber-50 text-amber-700 border-amber-200' }

export function EmailSoortBadge({ soort, onderwerp }: { soort: VerstuurdeEmail['soort']; onderwerp?: string }) {
  const s = soort === 'factuur' && onderwerp?.startsWith('Pakbon') ? PAKBON_STYLE : SOORT_STYLE[soort]
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border ${s.className}`}>
      {s.label}
    </span>
  )
}
