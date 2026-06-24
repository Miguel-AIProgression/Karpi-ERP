import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, Check, Clock, Loader2, Package } from 'lucide-react'
import { useAllocatieOpties } from '../hooks/use-reserveringen'
import { setAllocatieKeuze, type AllocatieKeuze } from '@/lib/supabase/queries/order-mutations'
import type { AllocatieOptie } from '../queries/allocatie-opties'
import type { OrderRegel } from '@/lib/supabase/queries/orders'
import type { OrderClaim } from '../queries/reserveringen'
import { invalidateNaReserveringsmutatie } from '../cache'
import { isoWeek } from '@/lib/orders/verzendweek'

interface Props {
  regel: OrderRegel
  /** Ongedekt aantal (te_leveren − Σ actieve claims) dat nu op "nieuwe inkoop" wacht. */
  tekort: number
  /** Actieve claims van deze regel — om bestaande handmatige keuzes te behouden. */
  claims: OrderClaim[]
}

function weekLabel(datumIso: string): string {
  const w = isoWeek(new Date(datumIso + 'T00:00:00'))
  return `wk ${w.week} · ${w.jaar}`
}

/** Greedy: vul het tekort op uit de beschikbare opties, levertijd-eerst (voorraad vóór inkoop). */
function vulTekort(opties: AllocatieOptie[], tekort: number): AllocatieKeuze[] {
  const gesorteerd = [...opties].sort((a, b) => {
    const ka = a.bron === 'voorraad' ? -1 : (a.verwacht_datum ? new Date(a.verwacht_datum).getTime() : Infinity)
    const kb = b.bron === 'voorraad' ? -1 : (b.verwacht_datum ? new Date(b.verwacht_datum).getTime() : Infinity)
    return ka - kb
  })
  let resterend = tekort
  const nieuw: AllocatieKeuze[] = []
  for (const o of gesorteerd) {
    if (resterend <= 0) break
    const pak = Math.min(o.vrij_aantal, resterend)
    if (pak > 0) {
      nieuw.push({
        bron: o.bron,
        artikelnr: o.artikelnr,
        aantal: pak,
        omschrijving: o.omschrijving,
        inkooporder_regel_id: o.inkooporder_regel_id,
        verwacht_datum: o.verwacht_datum,
      })
      resterend -= pak
    }
  }
  return nieuw
}

/**
 * Order-detail sub-rij die — wanneer een vaste-maat-regel op nieuwe inkoop wacht
 * terwijl er een (equivalent-voorraad of inkoop-) optie beschikbaar is — toont
 * dat de regel via die optie wél geleverd kan worden, met een knop om die
 * handmatige claim direct te zetten zonder de hele order te bewerken.
 *
 * Uitbreiding van de oorspronkelijke omsticker-knop (mig 154) met de twee
 * inkoop-optie-soorten uit `allocatie_opties_voor_artikel` (mig 491/493) —
 * geen automatische claim meer (mig 489), dit is altijd een bewuste klik.
 * Terugdraaien kan via de "Ontgrendelen"-rij die ernaast verschijnt zodra de
 * regel ≥1 handmatige claim heeft (zie `OntgrendelAllocatieKeuzeRij`).
 */
export function UitwisselbaarToepassenRij({ regel, tekort, claims }: Props) {
  const qc = useQueryClient()

  const { data: opties } = useAllocatieOpties(tekort > 0 ? regel.artikelnr ?? undefined : undefined)

  const toepassen = useMutation({
    mutationFn: (keuzes: AllocatieKeuze[]) => setAllocatieKeuze(regel.id, keuzes),
    onSuccess: () => invalidateNaReserveringsmutatie(qc),
  })

  if (tekort <= 0 || !opties) return null
  if (opties.length === 0) return null

  const nieuw = vulTekort(opties, tekort)
  const dekbaar = nieuw.reduce((s, k) => s + k.aantal, 0)
  if (dekbaar <= 0) return null

  // Bestaande handmatige claims (alle bronnen) behouden — set_allocatie_keuze
  // vervangt ÁLLE actieve claims van de regel, dus we sturen ze samen mee.
  const bestaande: AllocatieKeuze[] = claims
    .filter((c) => c.is_handmatig && c.fysiek_artikelnr)
    .map((c) => ({
      bron: c.bron,
      artikelnr: c.fysiek_artikelnr as string,
      aantal: c.aantal,
      inkooporder_regel_id: c.inkooporder_regel_id,
    }))

  function handleToepassen() {
    toepassen.mutate([...bestaande, ...nieuw])
  }

  return (
    <tr className="border-b border-slate-50 bg-emerald-50/40">
      <td className="px-4 py-1.5"></td>
      <td colSpan={3} className="px-4 py-1.5 text-xs">
        <span className="inline-flex items-center gap-2 pl-3 border-l-2 border-emerald-200 flex-wrap">
          <ArrowRightLeft size={12} className="text-emerald-600" />
          <span className="text-emerald-700 font-medium">
            {dekbaar}× leverbaar via {nieuw.some(k => k.bron === 'inkooporder_regel') ? 'inkoop/uitwisselbaar' : 'omstickeren'}
          </span>
          <span className="text-slate-500 inline-flex items-center gap-2 flex-wrap">
            uit{' '}
            {nieuw
              .map((k) => {
                const opt = opties.find((o) => o.artikelnr === k.artikelnr && o.inkooporder_regel_id === k.inkooporder_regel_id)
                return (
                  <span key={`${k.bron}:${k.artikelnr}:${k.inkooporder_regel_id ?? ''}`} className="inline-flex items-center gap-1">
                    {k.bron === 'voorraad' ? <Package size={10} /> : <Clock size={10} />}
                    {opt?.omschrijving ?? k.artikelnr} ({k.aantal}×
                    {k.bron === 'inkooporder_regel' && opt?.verwacht_datum && <> · {weekLabel(opt.verwacht_datum)}</>})
                  </span>
                )
              })}
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
            {toepassen.isSuccess ? 'Toegepast' : 'Bevestigen'}
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
