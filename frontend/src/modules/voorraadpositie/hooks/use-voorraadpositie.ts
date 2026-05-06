// TanStack Query-hooks voor Voorraadpositie-Module.
//
// queryKey-conventie (Voorraadpositie-Module):
//   * Single-paar:   ['voorraadpositie', kw, kl]
//   * Batch+filter:  ['voorraadposities', 'batch', kwaliteit?, kleur?, search?]
//                    — primaire prefix is bewust enkelvoud-vs-meervoud zodat
//                      cache-invalidation per modus eenvoudig blijft.
//                    — alle filter-velden zijn onderdeel van de key zodat elk
//                      filter-combo een eigen cache-entry heeft.
// staleTime 60_000 ms is consistent met andere "min/min" data-hooks
// in deze repo (zie modules/magazijn/hooks/use-magazijn-locaties.ts).

import { useQuery } from '@tanstack/react-query'
import {
  fetchVoorraadpositie,
  fetchVoorraadposities,
} from '../queries/voorraadposities'
import type { VoorraadpositieFilter } from '../types'

/** Single-paar — exact (kw, kl). Disabled bij lege strings. */
export function useVoorraadpositie(kwaliteit_code: string, kleur_code: string) {
  return useQuery({
    queryKey: ['voorraadpositie', kwaliteit_code, kleur_code],
    queryFn: () => fetchVoorraadpositie(kwaliteit_code, kleur_code),
    enabled: kwaliteit_code !== '' && kleur_code !== '',
    staleTime: 60_000,
  })
}

/**
 * Batch+filter — alle paren met eigen voorraad die matchen op `filter`.
 * queryKey omvat alle filter-velden zodat verschillende filter-combo's
 * onafhankelijk gecached worden.
 */
export function useVoorraadposities(filter: VoorraadpositieFilter) {
  return useQuery({
    queryKey: [
      'voorraadposities',
      'batch',
      filter.kwaliteit ?? null,
      filter.kleur ?? null,
      filter.search ?? null,
    ],
    queryFn: () => fetchVoorraadposities(filter),
    staleTime: 60_000,
  })
}
