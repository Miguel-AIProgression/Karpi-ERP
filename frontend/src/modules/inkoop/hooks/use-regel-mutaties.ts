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

// Wijzig/annuleer/verwijder kunnen server-side claims muteren: het
// vrijgeven-pad releaset order_reserveringen en roept herwaardeer_order_status
// aan — precies de claim-mutatie waarvoor de isOntvangst-keten bestaat.
// Daarom onvoorwaardelijk `{ isOntvangst: true }`, zelfde patroon als
// use-boek-ontvangst.ts. Regel toevoegen raakt nooit claims → bare invalidate.

export function useWijzigRegel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: wijzigInkooporderRegel,
    onSuccess: () => invalidateNaInkoopMutatie(qc, { isOntvangst: true }),
  })
}

export function useAnnuleerRegel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ regelId, vrijgeven }: { regelId: number; vrijgeven?: boolean }) =>
      annuleerInkooporderRegel(regelId, vrijgeven ?? false),
    onSuccess: () => invalidateNaInkoopMutatie(qc, { isOntvangst: true }),
  })
}

export function useVerwijderRegel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ regelId, vrijgeven }: { regelId: number; vrijgeven?: boolean }) =>
      verwijderInkooporderRegel(regelId, vrijgeven ?? false),
    onSuccess: () => invalidateNaInkoopMutatie(qc, { isOntvangst: true }),
  })
}
