// frontend/src/modules/magazijn/hooks/use-pickronde.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchColliVoorZending,
  fetchPickProblemen,
  markeerColliNietGevonden,
  startPickronde,
  voltooiPickronde,
  type MarkeerNietGevondenArgs,
} from '../queries/pickronde'

export function useColliVoorZending(zendingId: number | undefined) {
  return useQuery({
    queryKey: ['pickronde', 'colli', zendingId],
    queryFn: () => fetchColliVoorZending(zendingId!),
    enabled: zendingId != null,
    staleTime: 10_000,
  })
}

export function usePickProblemen() {
  return useQuery({
    queryKey: ['pickronde', 'problemen'],
    queryFn: fetchPickProblemen,
    staleTime: 30_000,
  })
}

export function useStartPickronde() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, pickerId }: { orderId: number; pickerId: number }) =>
      startPickronde(orderId, pickerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickronde'] })
      qc.invalidateQueries({ queryKey: ['pick-ship'] })
      qc.invalidateQueries({ queryKey: ['zendingen'] })
    },
  })
}

export function useMarkeerColliNietGevonden() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: MarkeerNietGevondenArgs) => markeerColliNietGevonden(args),
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ['pickronde'] })
      // Bij splits verandert ook zending_regels en aantal_colli.
      if (args.modus === 'splits') {
        qc.invalidateQueries({ queryKey: ['zendingen'] })
        qc.invalidateQueries({ queryKey: ['pick-ship'] })
      }
    },
  })
}

export function useVoltooiPickronde() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ zendingId, pickerId }: { zendingId: number; pickerId: number }) =>
      voltooiPickronde(zendingId, pickerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickronde'] })
      qc.invalidateQueries({ queryKey: ['zendingen'] })
      qc.invalidateQueries({ queryKey: ['pick-ship'] })
      // Factuur-keten kan vuren na voltooi (mig 217 sluit orders.status='Verzonden')
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['facturen'] })
    },
  })
}
