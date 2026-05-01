import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchPickShipOrders,
  fetchPickShipStats,
  updateSnijplanLocatie,
  type PickShipParams,
} from '@/lib/supabase/queries/pick-ship'

export function usePickShipOrders(params: PickShipParams = {}) {
  return useQuery({
    queryKey: ['pick-ship', 'orders', params],
    queryFn: () => fetchPickShipOrders(params),
  })
}

export function usePickShipStats() {
  return useQuery({
    queryKey: ['pick-ship', 'stats'],
    queryFn: () => fetchPickShipStats(),
  })
}

export function useUpdateSnijplanLocatie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ snijplanId, locatie }: { snijplanId: number; locatie: string | null }) =>
      updateSnijplanLocatie(snijplanId, locatie),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pick-ship'] })
    },
  })
}
