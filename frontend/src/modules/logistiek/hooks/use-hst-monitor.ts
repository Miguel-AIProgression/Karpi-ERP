import { useQuery } from '@tanstack/react-query'
import { fetchHstMonitor, fetchHstFouten, countOrdersZonderVervoerder } from '@/modules/logistiek/queries/hst-monitor'

export function useHstMonitor() {
  return useQuery({ queryKey: ['hst-monitor'], queryFn: fetchHstMonitor, refetchInterval: 30_000 })
}
export function useHstFouten() {
  return useQuery({ queryKey: ['hst-fouten'], queryFn: fetchHstFouten, refetchInterval: 30_000 })
}
export function useOrdersZonderVervoerderCount() {
  return useQuery({ queryKey: ['orders-zonder-vervoerder-count'], queryFn: countOrdersZonderVervoerder, refetchInterval: 60_000 })
}
