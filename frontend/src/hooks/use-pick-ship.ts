import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchPickShipOrders,
  fetchPickShipStats,
  updateMaatwerkLocatie,
  updateRolLocatieVoorArtikel,
  type PickShipParams,
} from '@/lib/supabase/queries/pick-ship'
import { createOrGetMagazijnLocatie } from '@/lib/supabase/queries/magazijn-locaties'

export function usePickShipOrders(params: PickShipParams = {}) {
  return useQuery({
    queryKey: ['pick-ship', 'orders', params],
    queryFn: () => fetchPickShipOrders(params),
    staleTime: 30_000,
  })
}

export function usePickShipStats() {
  return useQuery({
    queryKey: ['pick-ship', 'stats'],
    queryFn: () => fetchPickShipStats(),
    staleTime: 30_000,
  })
}

export function useUpdateMaatwerkLocatie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ orderRegelId, code }: { orderRegelId: number; code: string }) => {
      await createOrGetMagazijnLocatie(code)
      await updateMaatwerkLocatie(orderRegelId, code)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pick-ship'] }),
  })
}

export function useUpdateRolLocatie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ artikelnr, code }: { artikelnr: string; code: string }) => {
      const id = await createOrGetMagazijnLocatie(code)
      await updateRolLocatieVoorArtikel(artikelnr, id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pick-ship'] }),
  })
}
