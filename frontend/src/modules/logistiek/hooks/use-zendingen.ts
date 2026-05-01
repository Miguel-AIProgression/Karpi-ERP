import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createZendingVoorOrder,
  fetchZendingen,
  fetchZendingMetTransportorders,
  fetchZendingPrintSet,
  verstuurZendingOpnieuw,
  type ZendingenFilters,
} from '@/modules/logistiek/queries/zendingen'

export function useZendingen(filters: ZendingenFilters = {}) {
  return useQuery({
    queryKey: ['logistiek', 'zendingen', filters],
    queryFn: async () => {
      const { data, error } = await fetchZendingen(filters)
      if (error) throw error
      return data ?? []
    },
    refetchInterval: 30_000, // poll elke 30s zodat tracking-updates binnenkomen
  })
}

export function useZending(zending_nr: string | undefined) {
  return useQuery({
    queryKey: ['logistiek', 'zending', zending_nr],
    queryFn: async () => {
      const { data, error } = await fetchZendingMetTransportorders(zending_nr!)
      if (error) throw error
      return data
    },
    enabled: !!zending_nr,
    refetchInterval: 30_000,
  })
}

export function useZendingPrintSet(zending_nr: string | undefined) {
  return useQuery({
    queryKey: ['logistiek', 'zending-printset', zending_nr],
    queryFn: () => fetchZendingPrintSet(zending_nr!),
    enabled: !!zending_nr,
  })
}

export function useCreateZendingVoorOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderId: number) => createZendingVoorOrder(orderId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logistiek', 'zendingen'] })
      qc.invalidateQueries({ queryKey: ['pick-ship'] })
    },
  })
}

export function useVerstuurZendingOpnieuw() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (transportorder_id: number) => verstuurZendingOpnieuw(transportorder_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logistiek', 'zending'] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'zendingen'] })
    },
  })
}
