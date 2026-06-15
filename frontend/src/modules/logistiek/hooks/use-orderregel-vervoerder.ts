import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchEffectieveVervoerderPerOrderregel,
  updateOrderregelVervoerderOverride,
  type OrderregelVervoerder,
} from '../queries/orderregel-vervoerder'
import { useVervoerderResolutieContext } from '../context/vervoerder-resolutie-context'

const STALE_30_SEC = 30_000

/**
 * Per-orderregel vervoerder-data (mig 219). Cache-deelt query-key met
 * order-niveau zodat invalidations vanuit override-mutatie meteen door-
 * propageren.
 *
 * Batch-aware (mig 401): valt de order binnen een `VervoerderResolutieProvider`
 * (Pick & Ship), dan draait deze hook met `enabled: false` — hij fetcht dan
 * NIET zelf maar leest de door de provider geseede cache (React Query levert
 * cache-data ongeacht `enabled`). Zo blijft het 1 batch-call i.p.v. N losse.
 * Buiten een provider (order-detail e.d.) is het gedrag ongewijzigd: 1 losse
 * fetch per order.
 */
export function useEffectieveVervoerderPerOrderregel(orderId: number | null | undefined) {
  const batch = useVervoerderResolutieContext()
  const gedektDoorBatch = orderId != null && (batch?.heeftOrder(orderId) ?? false)
  return useQuery({
    queryKey: ['logistiek', 'orderregel-vervoerder', orderId],
    queryFn: () => fetchEffectieveVervoerderPerOrderregel(orderId!),
    enabled: orderId != null && !gedektDoorBatch,
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
      // Batch-cache (mig 401) heeft een andere key-stam en wordt NIET door de
      // prefix hierboven geraakt — apart invalideren zodat Pick & Ship herlaadt.
      qc.invalidateQueries({ queryKey: ['logistiek', 'orderregel-vervoerder-batch'] })
      // Order-niveau preview kan ook veranderen als override de eerste regel
      // betreft die toevallig de groepskeuze drijft.
      qc.invalidateQueries({ queryKey: ['logistiek', 'vervoerder-preview'] })
      // Mig 229: vervoerder is een dimensie van de bundel-sleutel — wijziging
      // betekent dat orders kunnen schuiven tussen voorgestelde-bundels in de
      // Pick & Ship live preview. Invalideer de view-cache.
      qc.invalidateQueries({ queryKey: ['voorgestelde-bundels'] })
      // Pickbaarheid-snapshot bevat geen vervoerder, dus daar geen invalidation.
      void vars
    },
  })
}

export type { OrderregelVervoerder }
