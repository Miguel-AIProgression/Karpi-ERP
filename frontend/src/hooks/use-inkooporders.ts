import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  boekOntvangst,
  boekVoorraadOntvangst,
  createInkooporder,
  fetchInkooporderDetail,
  fetchInkooporders,
  fetchInkooporderStats,
  updateInkooporderStatus,
  type InkooporderFilters,
  type InkooporderFormData,
  type InkooporderRegelInput,
  type InkooporderStatus,
  type OntvangstRol,
} from '@/lib/supabase/queries/inkooporders'

export function useInkooporders(filters: InkooporderFilters = {}) {
  return useQuery({
    queryKey: ['inkooporders', filters],
    queryFn: () => fetchInkooporders(filters),
  })
}

export function useInkooporderDetail(id: number | undefined) {
  return useQuery({
    queryKey: ['inkooporder-detail', id],
    queryFn: () => fetchInkooporderDetail(id as number),
    enabled: id !== undefined,
    staleTime: 0,
    retry: 1,
  })
}

export function useInkooporderStats() {
  return useQuery({
    queryKey: ['inkooporder-stats'],
    queryFn: fetchInkooporderStats,
    staleTime: 60 * 1000,
  })
}

export function useCreateInkooporder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ header, regels }: { header: InkooporderFormData; regels: InkooporderRegelInput[] }) =>
      createInkooporder(header, regels),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inkooporders'] })
      queryClient.invalidateQueries({ queryKey: ['inkooporder-stats'] })
      queryClient.invalidateQueries({ queryKey: ['leveranciers-overzicht'] })
    },
  })
}

export function useUpdateInkooporderStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: InkooporderStatus }) =>
      updateInkooporderStatus(id, status),
    onSuccess: (_r, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['inkooporders'] })
      queryClient.invalidateQueries({ queryKey: ['inkooporders', id] })
      queryClient.invalidateQueries({ queryKey: ['inkooporder-stats'] })
    },
  })
}

export function useBoekOntvangst() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      regelId,
      rollen,
      medewerker,
    }: {
      regelId: number
      rollen: OntvangstRol[]
      medewerker?: string
    }) => boekOntvangst(regelId, rollen, medewerker),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inkooporders'] })
      queryClient.invalidateQueries({ queryKey: ['inkooporder-detail'] })
      queryClient.invalidateQueries({ queryKey: ['inkooporder-stats'] })
      queryClient.invalidateQueries({ queryKey: ['rollen'] })
      queryClient.invalidateQueries({ queryKey: ['producten'] })
      queryClient.invalidateQueries({ queryKey: ['leveranciers-overzicht'] })
    },
  })
}

export function useBoekVoorraadOntvangst() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      regelId,
      aantal,
      medewerker,
    }: {
      regelId: number
      aantal: number
      medewerker?: string
    }) => boekVoorraadOntvangst(regelId, aantal, medewerker),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inkooporders'] })
      queryClient.invalidateQueries({ queryKey: ['inkooporder-stats'] })
      queryClient.invalidateQueries({ queryKey: ['producten'] })
      queryClient.invalidateQueries({ queryKey: ['leveranciers-overzicht'] })
    },
  })
}
