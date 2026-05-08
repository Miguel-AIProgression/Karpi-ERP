import { useQueries, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  startPickrondenVoorOrder,
  fetchZendingen,
  fetchZendingMetTransportorders,
  fetchZendingPrintSet,
  verstuurZendingOpnieuw,
  type ZendingenFilters,
  type ZendingPrintSet,
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

/**
 * Parallel fetch van meerdere zending-printsets in dezelfde volgorde als de
 * input. Gebruikt door de bulk-printset-pagina (`/logistiek/printset/bulk`)
 * waar één klik meerdere zendingen achter elkaar print.
 */
export function useZendingPrintSets(zending_nrs: string[]) {
  return useQueries({
    queries: zending_nrs.map((nr) => ({
      queryKey: ['logistiek', 'zending-printset', nr],
      queryFn: () => fetchZendingPrintSet(nr),
      enabled: !!nr,
    })),
    combine: (results) => ({
      data: results
        .map((r) => r.data)
        .filter((d): d is ZendingPrintSet => !!d),
      isLoading: results.some((r) => r.isLoading),
      hasError: results.some((r) => !!r.error),
      errors: results.map((r) => r.error).filter((e): e is Error => !!e),
    }),
  })
}

/**
 * Sinds mig 220 returnt deze mutation een **array** ZendingAanmaakResult — één
 * per unieke effectieve vervoerder. Voor single-vervoerder-orders is dat 1
 * element en gedraagt het zich zoals voorheen. UI-callers moeten op `length`
 * checken om wel/niet naar bulk-printset te navigeren.
 */
export function useCreateZendingVoorOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, pickerId }: { orderId: number; pickerId: number }) =>
      startPickrondenVoorOrder(orderId, pickerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logistiek', 'zendingen'] })
      qc.invalidateQueries({ queryKey: ['pick-ship'] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'orderregel-vervoerder'] })
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
