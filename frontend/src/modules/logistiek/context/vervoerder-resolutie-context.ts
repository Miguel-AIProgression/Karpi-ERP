// Vervoerder-resolutie-context — het context-object + hooks (géén component,
// zodat react-refresh blij blijft; de Provider-component leeft in
// `vervoerder-resolutie-provider.tsx`).
//
// Aanleiding (2026-06-15): elke Pick & Ship order-card resolveerde zijn
// vervoerder via een eigen `effectieve_vervoerder_per_orderregel(order_id)`-call.
// React Query dedupliceert per order_id, maar bij 266 zichtbare orders blijven
// dat 266 losse HTTP-calls. Zolang een card's call laadt staat zijn
// "Verzendset"-knop disabled en de vervoerder-pill leeg — de operator ziet
// "geblokkeerde" grijze knoppen terwijl er server-side niets mis is.
//
// De `VervoerderResolutieProvider` (zie provider-bestand) haalt de resolutie
// voor álle orders in scope in ÉÉN batch-call (mig 401) op, seedt de per-order
// query-caches, en levert via deze context:
//   - heeftOrder(id): valt de order binnen de batch-scope?
//   - getRegels(id):  de resolutie-regels (of [] als geladen-maar-leeg).
//   - isLoading:      laadt de batch nog?
// De per-order hook gate't op `heeftOrder` met `enabled: false` zodat hij niet
// zelf fetcht maar de geseede cache leest.
import { createContext, useContext, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchEffectieveVervoerderVoorOrders,
  type OrderregelVervoerder,
} from '../queries/orderregel-vervoerder'

const STALE_30_SEC = 30_000

/** Stabiele, gededupliceerde, gesorteerde batch-query-key. */
export function batchQueryKey(sortedIds: number[]) {
  return ['logistiek', 'orderregel-vervoerder-batch', sortedIds] as const
}

/**
 * Standalone batch-query-hook (mig 401). Haalt de vervoerder-resolutie voor een
 * set orders in ÉÉN call op. Gebruikt door zowel Pick & Ship (page-niveau maps:
 * filter + geblokkeerd-split) als de `VervoerderResolutieProvider` — dezelfde
 * queryKey, dus React Query dedupliceert naar één fetch.
 */
export function useEffectieveVervoerderVoorOrders(orderIds: number[]) {
  const sortedIds = useMemo(
    () => Array.from(new Set(orderIds)).sort((a, b) => a - b),
    [orderIds],
  )
  return useQuery({
    queryKey: batchQueryKey(sortedIds),
    queryFn: () => fetchEffectieveVervoerderVoorOrders(sortedIds),
    enabled: sortedIds.length > 0,
    staleTime: STALE_30_SEC,
  })
}

export interface VervoerderResolutieContextValue {
  /** True = deze order valt binnen de batch-scope → per-order hook moet niet zelf fetchen. */
  heeftOrder: (orderId: number) => boolean
  /**
   * Regels voor een order. Lege lijst zodra de batch klaar is en de order geen
   * (niet-VERZEND) regels heeft; `undefined` zolang de batch nog laadt of de
   * order buiten scope valt.
   */
  getRegels: (orderId: number) => OrderregelVervoerder[] | undefined
  /** Laadt de batch nog? Voedt de "vervoerder-resolutie laadt"-disable van de knoppen. */
  isLoading: boolean
}

export const VervoerderResolutieContext =
  createContext<VervoerderResolutieContextValue | null>(null)

/** Null buiten een provider — consumers vallen dan terug op losse resolutie. */
export function useVervoerderResolutieContext(): VervoerderResolutieContextValue | null {
  return useContext(VervoerderResolutieContext)
}
