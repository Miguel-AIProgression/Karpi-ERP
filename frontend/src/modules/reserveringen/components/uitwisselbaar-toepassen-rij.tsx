import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, Check, Loader2 } from 'lucide-react'
import { fetchEquivalenteProducten } from '@/lib/supabase/queries/product-equivalents'
import { setUitwisselbaarClaims } from '@/lib/supabase/queries/order-mutations'
import type { OrderRegel } from '@/lib/supabase/queries/orders'
import type { OrderClaim } from '../queries/reserveringen'
import { invalidateNaReserveringsmutatie } from '../cache'

interface Props {
  regel: OrderRegel
  /** Ongedekt aantal (te_leveren − Σ actieve claims) dat nu op "nieuwe inkoop" wacht. */
  tekort: number
  /** Actieve claims van deze regel — om bestaande handmatige keuzes te behouden. */
  claims: OrderClaim[]
}

interface Keuze {
  artikelnr: string
  aantal: number
}

/** Telt aantallen per artikelnr op (merge van bestaande + nieuwe keuzes). */
function mergeKeuzes(...lijsten: Keuze[][]): Keuze[] {
  const map = new Map<string, number>()
  for (const lijst of lijsten) {
    for (const k of lijst) {
      if (k.aantal > 0) map.set(k.artikelnr, (map.get(k.artikelnr) ?? 0) + k.aantal)
    }
  }
  return [...map.entries()].map(([artikelnr, aantal]) => ({ artikelnr, aantal }))
}

/**
 * Order-detail sub-rij die — wanneer een vaste-maat-regel op nieuwe inkoop wacht
 * terwijl er uitwisselbare voorraad beschikbaar is — toont dat de regel via
 * omstickeren wél geleverd kan worden, met een knop om die handmatige claim
 * direct te zetten zonder de hele order te bewerken.
 *
 * Omstickeren blijft een bewuste keuze (CLAUDE.md: "uitwisselbaar = handmatige
 * claims") — deze rij maakt die keuze alleen sneller zichtbaar én uitvoerbaar.
 * Werkt op live voorraad, dus ook voor reeds opgeslagen orders.
 */
export function UitwisselbaarToepassenRij({ regel, tekort, claims }: Props) {
  const qc = useQueryClient()

  const { data: equivalenten } = useQuery({
    queryKey: ['equivalente-producten-summary', regel.artikelnr],
    queryFn: () => fetchEquivalenteProducten(regel.artikelnr!),
    enabled: !!regel.artikelnr && tekort > 0,
    staleTime: 60_000,
  })

  const toepassen = useMutation({
    mutationFn: (keuzes: Keuze[]) => setUitwisselbaarClaims(regel.id, keuzes),
    onSuccess: () => invalidateNaReserveringsmutatie(qc),
  })

  if (tekort <= 0 || !equivalenten) return null

  const opVoorraad = equivalenten.filter((e) => (e.vrije_voorraad ?? 0) > 0)
  if (opVoorraad.length === 0) return null

  // Greedy-vul het tekort uit de uitwisselbare vrije voorraad (beste eerst).
  let resterend = tekort
  const nieuw: Keuze[] = []
  for (const eq of opVoorraad) {
    if (resterend <= 0) break
    const pak = Math.min(eq.vrije_voorraad, resterend)
    if (pak > 0) {
      nieuw.push({ artikelnr: eq.artikelnr, aantal: pak })
      resterend -= pak
    }
  }
  const dekbaar = tekort - resterend
  if (dekbaar <= 0) return null

  // Bestaande handmatige (omsticker)-claims behouden — set_uitwisselbaar_claims
  // vervangt álle handmatige claims, dus we sturen ze samen mee.
  const bestaande: Keuze[] = claims
    .filter((c) => c.is_handmatig && c.bron === 'voorraad' && c.fysiek_artikelnr)
    .map((c) => ({ artikelnr: c.fysiek_artikelnr as string, aantal: c.aantal }))

  function handleToepassen() {
    toepassen.mutate(mergeKeuzes(bestaande, nieuw))
  }

  return (
    <tr className="border-b border-slate-50 bg-emerald-50/40">
      <td className="px-4 py-1.5"></td>
      <td colSpan={3} className="px-4 py-1.5 text-xs">
        <span className="inline-flex items-center gap-2 pl-3 border-l-2 border-emerald-200 flex-wrap">
          <ArrowRightLeft size={12} className="text-emerald-600" />
          <span className="text-emerald-700 font-medium">
            {dekbaar}× leverbaar via omstickeren
          </span>
          <span className="text-slate-500">
            uit{' '}
            {nieuw
              .map((k) => {
                const eq = opVoorraad.find((e) => e.artikelnr === k.artikelnr)
                return `${eq?.omschrijving ?? k.artikelnr} (${k.aantal}×)`
              })
              .join(', ')}
          </span>
        </span>
      </td>
      <td className="px-4 py-1.5"></td>
      <td className="px-4 py-1.5 text-right text-xs font-medium text-emerald-700">{dekbaar}</td>
      <td colSpan={5} className="px-4 py-1.5">
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={handleToepassen}
            disabled={toepassen.isPending || toepassen.isSuccess}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {toepassen.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : toepassen.isSuccess ? (
              <Check size={12} />
            ) : (
              <ArrowRightLeft size={12} />
            )}
            {toepassen.isSuccess ? 'Toegepast' : 'Omstickeren toepassen'}
          </button>
          {toepassen.isError && (
            <span className="text-[11px] text-rose-700">
              {toepassen.error instanceof Error ? toepassen.error.message : 'Toepassen mislukt.'}
            </span>
          )}
        </div>
      </td>
    </tr>
  )
}
