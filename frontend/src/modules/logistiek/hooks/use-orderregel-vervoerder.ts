import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchEffectieveVervoerderPerOrderregel,
  updateOrderregelVervoerderOverride,
  type OrderregelVervoerder,
} from '../queries/orderregel-vervoerder'

const STALE_30_SEC = 30_000

/**
 * Per-orderregel vervoerder-data (mig 219). Cache-deelt query-key met
 * order-niveau zodat invalidations vanuit override-mutatie meteen door-
 * propageren.
 */
export function useEffectieveVervoerderPerOrderregel(orderId: number | null | undefined) {
  return useQuery({
    queryKey: ['logistiek', 'orderregel-vervoerder', orderId],
    queryFn: () => fetchEffectieveVervoerderPerOrderregel(orderId!),
    enabled: orderId != null,
    staleTime: STALE_30_SEC,
  })
}

export function useUpdateOrderregelVervoerderOverride() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      orderregelId,
      vervoerderCode,
    }: {
      orderregelId: number
      vervoerderCode: string | null
    }) => updateOrderregelVervoerderOverride(orderregelId, vervoerderCode),
    onSuccess: (_data, vars) => {
      // Invalideer per-regel-data voor élke order; orderId is hier niet bekend
      // zonder lookup en de RPC is goedkoop genoeg om grof te invalideren.
      qc.invalidateQueries({ queryKey: ['logistiek', 'orderregel-vervoerder'] })
      // Order-niveau preview kan ook veranderen als override de eerste regel
      // betreft die toevallig de groepskeuze drijft.
      qc.invalidateQueries({ queryKey: ['logistiek', 'vervoerder-preview'] })
      // Pickbaarheid-snapshot bevat geen vervoerder, dus daar geen invalidation.
      void vars
    },
  })
}

export type { OrderregelVervoerder }
