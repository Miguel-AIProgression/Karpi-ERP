// React-Query hook rond `levertijd_snelste_haalbaar` (mig 277). Manueel
// triggerbaar — `enabled: false`, dus pas vurend op `refetch()`. Gebruikt
// door de "klant heeft haast"-knop in order-form: pas op klik wordt de
// RPC geraadpleegd, niet bij elke render.

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { fetchSnelsteHaalbaar } from '../queries/levertijd'
import type { SnelsteHaalbaarResultaat } from '../types'

const STALE_TIME_MS = 30_000

export function useSnelsteHaalbaar(regelIds: number[]) {
  // Gesorteerde id-array zodat de cache-key onafhankelijk is van regel-volgorde.
  const sortedIds = [...regelIds].sort((a, b) => a - b)

  return useQuery<SnelsteHaalbaarResultaat[], Error>({
    queryKey: ['levertijd', 'snelste-haalbaar', sortedIds],
    queryFn: () => fetchSnelsteHaalbaar(supabase, sortedIds),
    enabled: false, // manueel triggerbaar via `refetch()`
    staleTime: STALE_TIME_MS,
    refetchOnWindowFocus: false,
  })
}
