import { useQuery } from '@tanstack/react-query'
import {
  fetchLevertijdVoorOrder,
  fetchClaimsVoorOrder,
  fetchClaimsVoorOrderRegel,
  fetchClaimsVoorIORegel,
  fetchHandmatigeKeuzesVoorOrder,
} from '../queries/reserveringen'
import { fetchAllocatieOpties } from '../queries/allocatie-opties'

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

export function useHandmatigeKeuzesVoorOrder(orderId?: number) {
  return useQuery({
    queryKey: ['handmatige-keuzes', orderId],
    queryFn: () => fetchHandmatigeKeuzesVoorOrder(orderId!),
    enabled: !!orderId,
  })
}

/** Live 3-opties-databron (mig 498/500) voor een tekort op `artikelnr`. */
export function useAllocatieOpties(artikelnr?: string) {
  return useQuery({
    queryKey: ['allocatie-opties', artikelnr],
    queryFn: () => fetchAllocatieOpties(artikelnr!),
    enabled: !!artikelnr,
  })
}
