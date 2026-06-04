import type { QueryClient } from '@tanstack/react-query'

/**
 * Cross-Module cache-invalidation seam (ADR-0015, Ingreep 5).
 *
 * Roep deze helper aan in elke mutation die `order_reserveringen`-rijen of
 * afgeleide claim-state muteert (set_uitwisselbaar_claims, herallocateer_*,
 * IO-ontvangst, IO-annulering, order-annulering). Andere Modules die op
 * claim-mutaties reageren bezitten hun eigen `cache.ts`.
 *
 * Producer-mutaties roepen dus typisch:
 *   invalidateNaReserveringsmutatie(qc)
 *   invalidateNaOrdersMutatie(qc)  // bij volledige order-saves
 *
 * Eén publieke functie i.p.v. fijn-granular event-typen: invalidation is goed-
 * koop en React Query refetcht alleen actieve queries, dus we leveren depth via
 * de korte interface (één naam) en bewaren locality via de Module-grens.
 */
export function invalidateNaReserveringsmutatie(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['order-levertijd'] })
  qc.invalidateQueries({ queryKey: ['order-claims'] })
  qc.invalidateQueries({ queryKey: ['order-regel-claims'] })
  qc.invalidateQueries({ queryKey: ['io-regel-claims'] })
  qc.invalidateQueries({ queryKey: ['handmatige-keuzes'] })
  qc.invalidateQueries({ queryKey: ['producten'] }) // wegens gereserveerd-cache
  qc.invalidateQueries({ queryKey: ['equivalente-producten-summary'] }) // vrije voorraad uitwisselbaar wijzigt bij omsticker-claim
}
