import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createLeverancier,
  fetchLeveranciersOverzicht,
  fetchLeverancierDetail,
  toggleLeverancierActief,
  updateLeverancier,
  type LeverancierFormData,
} from '@/lib/supabase/queries/leveranciers'

export function useLeveranciersOverzicht() {
  return useQuery({
    queryKey: ['leveranciers-overzicht'],
    queryFn: fetchLeveranciersOverzicht,
  })
}

export function useLeverancierDetail(id: number | undefined) {
  return useQuery({
    queryKey: ['leveranciers', id],
    queryFn: () => fetchLeverancierDetail(id as number),
    enabled: id !== undefined,
  })
}

export function useCreateLeverancier() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: LeverancierFormData) => createLeverancier(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leveranciers-overzicht'] })
      queryClient.invalidateQueries({ queryKey: ['leveranciers'] })
    },
  })
}

export function useUpdateLeverancier() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<LeverancierFormData> }) =>
      updateLeverancier(id, data),
    onSuccess: (_r, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['leveranciers-overzicht'] })
      queryClient.invalidateQueries({ queryKey: ['leveranciers', id] })
    },
  })
}

export function useToggleLeverancierActief() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, actief }: { id: number; actief: boolean }) => toggleLeverancierActief(id, actief),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leveranciers-overzicht'] })
    },
  })
}
