// React-Query hook voor `orders.levertijd_status` + snapshot, voor het renderen
// van de status-badge (stap 5). Trigger uit mig 276 deriveert de status
// automatisch — deze hook leest 'm alleen.

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { fetchLevertijdStatus, type LevertijdStatusRow } from '../queries/levertijd'

const STALE_TIME_MS = 30_000

export function useLevertijdStatus(orderId: number | null) {
  return useQuery<LevertijdStatusRow, Error>({
    queryKey: ['levertijd', 'status', orderId],
    queryFn: () => fetchLevertijdStatus(supabase, orderId!),
    enabled: !!orderId,
    staleTime: STALE_TIME_MS,
  })
}
