import type { QueryClient } from '@tanstack/react-query'
import { invalidateNaReserveringsmutatie } from '@/modules/reserveringen'

/**
 * Cross-Module cache-invalidation seam (ADR-0016, Ingreep 4).
 *
 * Roep deze helper aan in elke mutation die `inkooporders`-, `inkooporder_regels`-
 * of `leveranciers`-rijen muteert (create, update, ontvangst boeken, annulering).
 * Andere Modules die op Inkoop-mutaties reageren bezitten hun eigen `cache.ts`.
 *
 * Bij ontvangst-mutaties (`isOntvangst: true`) chain'en we
 * `invalidateNaReserveringsmutatie` omdat Inkoop's ontvangst-RPC's
 * `boek_io_ontvangst_claims` (mig 254) aanroepen — die muteert claims aan
 * de server-zijde, dus Reservering's cache moet meekoelen.
 *
 * Producer-mutaties roepen typisch:
 *   invalidateNaInkoopMutatie(qc)                            // create/update
 *   invalidateNaInkoopMutatie(qc, { isOntvangst: true })     // boek-ontvangst
 *
 * Eén publieke functie i.p.v. fijn-granular event-typen: invalidation is
 * goedkoop en React Query refetcht alleen actieve queries, dus we leveren
 * depth via de korte interface (één naam) en bewaren locality via de
 * Module-grens.
 */
export function invalidateNaInkoopMutatie(
  qc: QueryClient,
  opties: { isOntvangst?: boolean } = {},
): void {
  qc.invalidateQueries({ queryKey: ['inkooporders'] })
  qc.invalidateQueries({ queryKey: ['inkooporder-regels'] }) // future: query-key wordt geactiveerd in Task 3
  qc.invalidateQueries({ queryKey: ['leveranciers'] })
  // `producten` is óók de cache-sleutel voor Reservering's `gereserveerd`-veld;
  // bij `isOntvangst: true` wordt 'm via de chain-aanroep opnieuw geïnvalideerd
  // (idempotent; React Query dedupliceert binnen één tick). De eerste invalidate
  // hier is nodig voor non-ontvangst-mutaties (besteld_inkoop-cache).
  qc.invalidateQueries({ queryKey: ['producten'] })

  if (opties.isOntvangst) {
    invalidateNaReserveringsmutatie(qc)
  }
}
