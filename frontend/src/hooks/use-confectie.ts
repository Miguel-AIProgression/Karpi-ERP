import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchConfectieOrders,
  fetchConfectieStatusCounts,
  fetchConfectieDetail,
  fetchConfectieByScancode,
} from '@/lib/supabase/queries/confectie'
import type { ConfectieSortField, SortDirection } from '@/lib/supabase/queries/confectie'
import {
  updateConfectieStatus,
  scanConfectieStart,
  scanConfectieGereed,
} from '@/lib/supabase/queries/confectie-mutations'
import type { ConfectieStatus } from '@/lib/types/productie'

export function useConfectieOrders(params: {
  status?: string
  search?: string
  page?: number
  pageSize?: number
  sortBy?: ConfectieSortField
  sortDir?: SortDirection
}) {
  return useQuery({
    queryKey: ['confectie', params],
    queryFn: () => fetchConfectieOrders(params),
  })
}

export function useConfectieStatusCounts() {
  return useQuery({
    queryKey: ['confectie', 'status-counts'],
    queryFn: fetchConfectieStatusCounts,
  })
}

export function useConfectieDetail(id: number | null) {
  return useQuery({
    queryKey: ['confectie', id],
    queryFn: () => fetchConfectieDetail(id!),
    enabled: !!id,
  })
}

export function useConfectieByScancode(scancode: string | null) {
  return useQuery({
    queryKey: ['confectie', 'scan', scancode],
    queryFn: () => fetchConfectieByScancode(scancode!),
    enabled: !!scancode,
  })
}

export function useUpdateConfectieStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: ConfectieStatus }) =>
      updateConfectieStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['confectie'] })
      qc.invalidateQueries({ queryKey: ['productie', 'dashboard'] })
    },
  })
}

export function useScanConfectieStart() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, medewerker }: { id: number; medewerker: string }) =>
      scanConfectieStart(id, medewerker),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['confectie'] })
      qc.invalidateQueries({ queryKey: ['productie', 'dashboard'] })
    },
  })
}

export function useScanConfectieGereed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, medewerker }: { id: number; medewerker: string }) =>
      scanConfectieGereed(id, medewerker),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['confectie'] })
      qc.invalidateQueries({ queryKey: ['productie', 'dashboard'] })
    },
  })
}
