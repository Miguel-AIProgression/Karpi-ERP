// TanStack Query-hook voor Voorraadpositie-Module.
//
// queryKey-conventie: ['voorraadpositie', kw, kl] — single-paar.
// staleTime 60_000 ms is consistent met andere "min/min" data-hooks
// in deze repo (zie modules/magazijn/hooks/use-magazijn-locaties.ts).

import { useQuery } from '@tanstack/react-query'
import { fetchVoorraadpositie } from '../queries/voorraadposities'

export function useVoorraadpositie(kwaliteit_code: string, kleur_code: string) {
  return useQuery({
    queryKey: ['voorraadpositie', kwaliteit_code, kleur_code],
    queryFn: () => fetchVoorraadpositie(kwaliteit_code, kleur_code),
    enabled: kwaliteit_code !== '' && kleur_code !== '',
    staleTime: 60_000,
  })
}
