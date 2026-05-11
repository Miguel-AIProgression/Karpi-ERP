import type { QueryClient } from '@tanstack/react-query'

/**
 * Cross-Module cache-invalidation seam (ADR-0013, Ingreep 2).
 *
 * Roep deze helper aan in elke mutation die rijen raakt waardoor de Confectie-
 * view-output kan veranderen — eigen status-mutaties (start/voltooi confectie,
 * scan-station-stappen) én cross-Module mutaties die `snijplannen.status` naar
 * 'Gesneden' brengen. Dat laatste is precies wat na "Rol afsluiten" gebeurt
 * en wat eerder de "stuk verschijnt niet onder Klaar voor confectie"-bug
 * veroorzaakte (mig 246-tijdvak).
 *
 * De view `confectie_planning_forward` (mig 098/243) en `confectie_overzicht`
 * lezen `snijplannen.status` direct — er is geen DB-trigger die confectie-
 * caches "weet" dat de snijplan-status is veranderd, dus de invalidatie moet
 * vanuit de producer komen.
 */
export function invalidateNaConfectieMutatie(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['confectie'] })
  qc.invalidateQueries({ queryKey: ['confectie-planning'] })
  qc.invalidateQueries({ queryKey: ['confectie-werktijden'] })
}
