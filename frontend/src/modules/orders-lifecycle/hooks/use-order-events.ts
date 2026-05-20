import { useQuery } from '@tanstack/react-query'
import { fetchOrderEvents } from '../queries/order-events'

/**
 * Hook voor order_events van een order — gebruikt door order-detail UI om
 * swap-/conflict-events te renderen. Cache-key is `['order-events', orderId]`,
 * dezelfde key die `useMarkeerGeannuleerd` al invalidate't (mig 218).
 */
export function useOrderEvents(orderId?: number) {
  return useQuery({
    queryKey: ['order-events', orderId],
    queryFn: () => fetchOrderEvents(orderId!),
    enabled: !!orderId,
  })
}
