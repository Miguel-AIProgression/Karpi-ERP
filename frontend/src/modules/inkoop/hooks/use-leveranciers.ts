import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createLeverancier,
  fetchLeverancierDetail,
  fetchLeveranciersOverzicht,
  toggleLeverancierActief,
  updateLeverancier,
  type LeverancierFormData,
} from '../queries/leveranciers'
import { invalidateNaInkoopMutatie } from '../cache'

/**
 * Module-interne hooks voor leveranciers.
 * Mutations roepen `invalidateNaInkoopMutatie(qc)` aan — die invalideert
 * o.a. `['leveranciers']` waardoor zowel detail- als overzicht-queries
 * onder die wortel meekoelen.
 */

export function useLeveranciersOverzicht() {
  return useQuery({
    queryKey: ['leveranciers', 'overzicht'],
    queryFn: fetchLeveranciersOverzicht,
  })
}

export function useLeverancierDetail(id: number | undefined) {
  return useQuery({
    queryKey: ['leveranciers', 'detail', id],
    queryFn: () => fetchLeverancierDetail(id!),
    enabled: id !== undefined,
  })
}

export function useCreateLeverancier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: LeverancierFormData) => createLeverancier(data),
    onSuccess: () => invalidateNaInkoopMutatie(qc),
  })
}

export function useUpdateLeverancier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<LeverancierFormData> }) =>
      updateLeverancier(id, data),
    onSuccess: () => invalidateNaInkoopMutatie(qc),
  })
}

export function useToggleLeverancierActief() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, actief }: { id: number; actief: boolean }) =>
      toggleLeverancierActief(id, actief),
    onSuccess: () => invalidateNaInkoopMutatie(qc),
  })
}
