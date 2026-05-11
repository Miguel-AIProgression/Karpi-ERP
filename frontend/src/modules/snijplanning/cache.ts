import type { QueryClient } from '@tanstack/react-query'

/**
 * Cross-Module cache-invalidation seam (ADR-0013, Ingreep 2).
 *
 * Roep deze helper aan in elke mutation die snijplan-rijen, snijvoorstellen,
 * rollen of productie-dashboard-data muteert. Andere Modules die op snijplan-
 * mutaties reageren (Confectie via `confectie_planning_forward`-view) bezitten
 * hun eigen `cache.ts` met een eigen `invalidateNa<Domein>Mutatie`-helper.
 *
 * Producer-mutaties roepen dus typisch:
 *   invalidateNaSnijplanMutatie(qc)
 *   invalidateNaConfectieMutatie(qc)  // import uit '@/modules/confectie'
 *
 * Eén publieke functie i.p.v. fijn-granular event-typen: invalidation is goed-
 * koop en React Query refetcht alleen actieve queries, dus we leveren depth via
 * de korte interface (één naam) en bewaren locality via de Module-grens.
 */
export function invalidateNaSnijplanMutatie(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['snijplanning'] })
  qc.invalidateQueries({ queryKey: ['snijvoorstel'] })
  qc.invalidateQueries({ queryKey: ['rollen'] })
  qc.invalidateQueries({ queryKey: ['productie', 'dashboard'] })
}
