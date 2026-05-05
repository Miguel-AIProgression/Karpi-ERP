import { useQuery } from '@tanstack/react-query'
import {
  fetchLevertijdVoorOrder,
  fetchClaimsVoorOrder,
  fetchClaimsVoorOrderRegel,
  fetchClaimsVoorIORegel,
} from '@/lib/supabase/queries/reserveringen'

export function useLevertijdVoorOrder(orderId?: number) {
  return useQuery({
    queryKey: ['order-levertijd', orderId],
    queryFn: () => fetchLevertijdVoorOrder(orderId!),
    enabled: !!orderId,
  })
}

export function useClaimsVoorOrder(orderId?: number) {
  return useQuery({
    queryKey: ['order-claims', orderId],
    queryFn: () => fetchClaimsVoorOrder(orderId!),
    enabled: !!orderId,
  })
}

export function useClaimsVoorOrderRegel(orderRegelId?: number) {
  return useQuery({
    queryKey: ['order-regel-claims', orderRegelId],
    queryFn: () => fetchClaimsVoorOrderRegel(orderRegelId!),
    enabled: !!orderRegelId,
  })
}

export function useClaimsVoorIORegel(ioRegelId?: number) {
  return useQuery({
    queryKey: ['io-regel-claims', ioRegelId],
    queryFn: () => fetchClaimsVoorIORegel(ioRegelId!),
    enabled: !!ioRegelId,
  })
}
