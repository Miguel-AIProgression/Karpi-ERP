// VervoerderResolutieProvider — batch-resolutie van de effectieve vervoerder
// voor een set orders, zodat Pick & Ship niet N losse RPC-calls afvuurt.
// Context-object + hooks staan in `vervoerder-resolutie-context.ts`.
//
// Werking:
//   1. Eén batch-call (mig 401) over alle order_ids in scope.
//   2. Zodra de batch binnen is, seedt de provider de per-order query-caches
//      (`['logistiek','orderregel-vervoerder', orderId]`) via setQueryData.
//   3. De per-order hook (`useEffectieveVervoerderPerOrderregel`) draait voor
//      batch-gedekte orders met `enabled: false` — die fetcht dus NOOIT zelf,
//      maar leest de geseede data uit de cache (React Query levert cache-data
//      ongeacht `enabled`). Geen race, geen losse calls, geen nep-query-result.
//
// Buiten een provider (bv. order-detail, bulk-printset) is `heeftOrder` false
// en valt de per-order hook terug op zijn eigen losse fetch (1 order = 1 call).
import { useEffect, useMemo, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  VervoerderResolutieContext,
  useEffectieveVervoerderVoorOrders,
  type VervoerderResolutieContextValue,
} from './vervoerder-resolutie-context'

interface ProviderProps {
  orderIds: number[]
  children: ReactNode
}

export function VervoerderResolutieProvider({ orderIds, children }: ProviderProps) {
  const qc = useQueryClient()

  const scope = useMemo(() => new Set(orderIds), [orderIds])
  // Hergebruikt dezelfde queryKey als de page-niveau hook → React Query
  // dedupliceert naar één fetch.
  const query = useEffectieveVervoerderVoorOrders(orderIds)
  const sortedIds = useMemo(() => Array.from(scope).sort((a, b) => a - b), [scope])

  // Seed de per-order caches zodat de cards (enabled:false) hun data uit de
  // cache lezen. Orders zonder regels krijgen expliciet [] zodat de card weet
  // "geladen, maar leeg" i.p.v. eeuwig undefined.
  const data = query.data
  useEffect(() => {
    if (!data) return
    for (const id of sortedIds) {
      qc.setQueryData(['logistiek', 'orderregel-vervoerder', id], data.get(id) ?? [])
    }
  }, [data, sortedIds, qc])

  const value = useMemo<VervoerderResolutieContextValue>(
    () => ({
      heeftOrder: (orderId) => scope.has(orderId),
      getRegels: (orderId) => {
        if (!data) return undefined
        if (!scope.has(orderId)) return undefined
        return data.get(orderId) ?? []
      },
      isLoading: query.isLoading,
    }),
    [scope, data, query.isLoading],
  )

  return (
    <VervoerderResolutieContext.Provider value={value}>
      {children}
    </VervoerderResolutieContext.Provider>
  )
}
