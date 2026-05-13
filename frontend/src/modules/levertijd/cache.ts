import type { QueryClient } from '@tanstack/react-query'

/**
 * Cross-Module cache-invalidation seam voor de Levertijd-Module (ADR-0020).
 *
 * Roep deze helper aan in elke mutatie die het `levertijd_status`-label of de
 * `orders.afleverdatum` kan beïnvloeden (fit-check overrides, snelste-haalbaar-
 * berekeningen, spoed-aanvragen, herevaluatie van de eerstvolgende-haalbaar-
 * week). Andere Modules die hierop reageren bezitten hun eigen `cache.ts`.
 *
 * Producer-mutaties roepen typisch:
 *   invalidateNaLevertijdMutatie(qc)
 *
 * Eén publieke functie i.p.v. fijn-granular event-typen: invalidation is
 * goedkoop en React Query refetcht alleen actieve queries, dus we leveren
 * depth via de korte interface (één naam) en bewaren locality via de
 * Module-grens. Conform Snijplanning- / Reservering- / Inkoop-precedent.
 */
export function invalidateNaLevertijdMutatie(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['levertijd'] })
}
