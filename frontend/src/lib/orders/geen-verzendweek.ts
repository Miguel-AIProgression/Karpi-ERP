// Geen-verzendweek-seam: orders waarvan afleverdatum NULL is hebben geen
// verzendweek en zijn daardoor niet in te plannen in Pick & Ship.
// Aanleiding: SB MÖBEL BOSS / OSTERMANN EDI-orders kwamen binnen zonder
// afleverdatum in het EDI-bericht — 73 orders toonden "—" als verzendweek
// en zweefden zonder weekindeling in Pick & Ship (gevonden 2026-06-24).
//
// Scope: alleen niet-productie-only, open orders (Verzonden/Geannuleerd
// hoeven geen datum). Spiegelt hetzelfde filter in fetchOrders / fetchStatusCounts.

export interface GeenVerzendweekVelden {
  afleverdatum?: string | null
  status?: string | null
  alleen_productie?: boolean | null
}

const EIND_STATUSSEN = new Set(['Verzonden', 'Geannuleerd'])

/** True als deze order geen verzendweek heeft en dat een actie-punt is. */
export function isGeenVerzendweek(order: GeenVerzendweekVelden): boolean {
  if (order.alleen_productie) return false
  if (EIND_STATUSSEN.has(order.status ?? '')) return false
  return !order.afleverdatum
}

interface PostgrestIsNeqEqBuilder {
  is(column: string, value: null): PostgrestIsNeqEqBuilder
  not(column: string, operator: string, value: unknown): PostgrestIsNeqEqBuilder
  eq(column: string, value: unknown): PostgrestIsNeqEqBuilder
}

/** Past het 'Geen verzendweek'-filter toe op een query-builder. */
export function filterGeenVerzendweek<Q>(query: Q): Q {
  return (query as unknown as PostgrestIsNeqEqBuilder)
    .is('afleverdatum', null)
    .not('status', 'in', '("Verzonden","Geannuleerd")')
    .eq('alleen_productie', false) as unknown as Q
}
