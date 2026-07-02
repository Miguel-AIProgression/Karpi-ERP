import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  annuleerInkooporderRegel,
  verwijderInkooporderRegel,
  voegInkooporderRegelToe,
  wijzigInkooporderRegel,
} from '../queries/regel-mutaties'
import type { InkooporderRegelInput } from '../queries/inkooporders'
import { invalidateNaInkoopMutatie } from '../cache'

export function useVoegRegelToe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      inkooporderId,
      regel,
    }: {
      inkooporderId: number
      regel: Omit<InkooporderRegelInput, 'regelnummer'>
    }) => voegInkooporderRegelToe(inkooporderId, regel),
    onSuccess: () => invalidateNaInkoopMutatie(qc),
  })
}

export function useWijzigRegel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: wijzigInkooporderRegel,
    onSuccess: () => invalidateNaInkoopMutatie(qc),
  })
}

export function useAnnuleerRegel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ regelId, vrijgeven }: { regelId: number; vrijgeven?: boolean }) =>
      annuleerInkooporderRegel(regelId, vrijgeven ?? false),
    onSuccess: () => invalidateNaInkoopMutatie(qc),
  })
}

export function useVerwijderRegel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ regelId, vrijgeven }: { regelId: number; vrijgeven?: boolean }) =>
      verwijderInkooporderRegel(regelId, vrijgeven ?? false),
    onSuccess: () => invalidateNaInkoopMutatie(qc),
  })
}
