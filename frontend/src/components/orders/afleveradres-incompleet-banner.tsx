import { Link } from 'react-router-dom'
import { MapPinOff, Pencil } from 'lucide-react'
import { ontbrekendeAfleveradresVelden } from '@/lib/orders/afleveradres-gate'

interface Props {
  orderId: number
  afl_naam?: string | null
  afl_adres?: string | null
  afl_postcode?: string | null
  afl_plaats?: string | null
}

/**
 * Blokkade-banner (mig 395): het afleveradres-snapshot van deze order is
 * onvolledig. Anders dan de "te bevestigen"-gates is dit een HARDE blokkade —
 * start_pickronden weigert de order tot het adres compleet is, zodat er nooit
 * een verzendlabel zonder adres geprint wordt (aanleiding: ORD-2026-0097).
 * Rood i.p.v. amber omdat de order niet kan doorstromen voordat dit is opgelost.
 *
 * Geen bevestig-knop: de gate lost zichzelf op zodra het adres via "Bewerk
 * order" is aangevuld (de DB-trigger wist afl_adres_incompleet_sinds).
 */
export function AfleveradresIncompleetBanner({ orderId, ...velden }: Props) {
  const ontbreekt = ontbrekendeAfleveradresVelden(velden)

  return (
    <div className="mb-4 flex items-center gap-3 rounded-[var(--radius)] border border-rose-300 bg-rose-50 px-4 py-3">
      <MapPinOff size={18} className="shrink-0 text-rose-600" />
      <div className="flex-1 text-sm text-rose-800">
        <span className="font-semibold">Afleveradres onvolledig</span> — deze order
        kan niet naar Pick &amp; Ship doorstromen zolang het verzendadres ontbreekt.
        {ontbreekt.length > 0 && (
          <>
            {' '}Ontbreekt: <span className="font-medium">{ontbreekt.join(', ')}</span>.
          </>
        )}{' '}
        De verzendlabels krijgen anders geen adres mee.
      </div>
      <Link
        to={`/orders/${orderId}/bewerken`}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-rose-700"
      >
        <Pencil size={14} />
        Adres aanvullen
      </Link>
    </div>
  )
}
