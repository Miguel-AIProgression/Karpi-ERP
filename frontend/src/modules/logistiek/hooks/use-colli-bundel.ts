import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchRhenusAanmelding,
  fetchZendingColliVoorBundel,
  maakColliBundel,
  meldZendingHandmatigAan,
  verwijderColliBundel,
} from '../queries/colli-bundel'

export function useZendingColliVoorBundel(zendingId: number | undefined) {
  return useQuery({
    queryKey: ['logistiek', 'colli-bundel', zendingId],
    queryFn: () => fetchZendingColliVoorBundel(zendingId!),
    enabled: !!zendingId,
  })
}

export function useRhenusAanmelding(zendingId: number | undefined) {
  return useQuery({
    queryKey: ['logistiek', 'rhenus-aanmelding', zendingId],
    queryFn: () => fetchRhenusAanmelding(zendingId!),
    enabled: !!zendingId,
  })
}

function useInvalidateBundel(zendingId: number | undefined) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['logistiek', 'colli-bundel', zendingId] })
    qc.invalidateQueries({ queryKey: ['logistiek', 'rhenus-aanmelding', zendingId] })
    qc.invalidateQueries({ queryKey: ['logistiek', 'zending'] })
    qc.invalidateQueries({ queryKey: ['logistiek', 'zending-printset'] })
  }
}

export function useMaakColliBundel(zendingId: number | undefined) {
  const invalidate = useInvalidateBundel(zendingId)
  return useMutation({
    mutationFn: (p: {
      colliIds: number[]
      gewichtKg?: number | null
      lengteCm?: number | null
      breedteCm?: number | null
      palletType?: string | null
      hoogteCm?: number | null
    }) => maakColliBundel({ zendingId: zendingId!, ...p }),
    onSuccess: invalidate,
  })
}

export function useVerwijderColliBundel(zendingId: number | undefined) {
  const invalidate = useInvalidateBundel(zendingId)
  return useMutation({
    mutationFn: (bundelColliId: number) => verwijderColliBundel(bundelColliId),
    onSuccess: invalidate,
  })
}

export function useMeldZendingHandmatigAan(zendingId: number | undefined) {
  const invalidate = useInvalidateBundel(zendingId)
  return useMutation({
    mutationFn: () => meldZendingHandmatigAan(zendingId!),
    onSuccess: invalidate,
  })
}
