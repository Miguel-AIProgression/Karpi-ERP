import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Unlock } from 'lucide-react'
import { ontgrendelAllocatieKeuze } from '@/lib/supabase/queries/order-mutations'
import { invalidateNaReserveringsmutatie } from '../cache'

interface Props {
  orderRegelId: number
}

/**
 * Order-detail sub-rij die het terugdraaien van een bevestigde allocatie-
 * keuze aanbiedt (omsticker-voorraad of inkoop-claim, mig 499-500) — release
 * de handmatige claim(s) en valt terug op alleen eigen voorraad (de korte
 * allocator-vorm, géén automatische herclaim). Verschijnt náást de bestaande
 * claim-uitsplitsing zodra de regel ≥1 actieve handmatige claim heeft.
 */
export function OntgrendelAllocatieKeuzeRij({ orderRegelId }: Props) {
  const qc = useQueryClient()

  const ontgrendelen = useMutation({
    mutationFn: () => ontgrendelAllocatieKeuze(orderRegelId),
    onSuccess: () => invalidateNaReserveringsmutatie(qc),
  })

  return (
    <tr className="border-b border-slate-50">
      <td className="px-4 py-1.5"></td>
      <td colSpan={10} className="px-4 py-1.5">
        <div className="flex items-center gap-2 pl-3 border-l-2 border-slate-200">
          <button
            type="button"
            onClick={() => {
              if (!window.confirm('Allocatie-keuze terugdraaien? De regel valt terug op eigen voorraad; een eventueel restant gaat weer op "wacht op nieuwe inkoop" totdat opnieuw gekozen wordt.')) return
              ontgrendelen.mutate()
            }}
            disabled={ontgrendelen.isPending || ontgrendelen.isSuccess}
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-rose-600 disabled:opacity-50"
          >
            {ontgrendelen.isPending ? <Loader2 size={12} className="animate-spin" /> : <Unlock size={12} />}
            {ontgrendelen.isSuccess ? 'Ontgrendeld' : 'Allocatie-keuze ontgrendelen'}
          </button>
          {ontgrendelen.isError && (
            <span className="text-[11px] text-rose-700">
              {ontgrendelen.error instanceof Error ? ontgrendelen.error.message : 'Ontgrendelen mislukt.'}
            </span>
          )}
        </div>
      </td>
    </tr>
  )
}
