// frontend/src/modules/magazijn/hooks/use-pickronde.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  annuleerPickronde,
  fetchColliVoorZending,
  fetchPickProblemen,
  herstelColli,
  markeerColliNietGevonden,
  startPickronde,
  voltooiPickronde,
  voltooiPickrondes,
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

// Mig 518: niet-gevonden zet alleen de colli op 'niet_gevonden' (geen
// zending-mutatie meer — het afsplitsen naar Manco gebeurt bij voltooien).
export function useMarkeerColliNietGevonden() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: MarkeerNietGevondenArgs) => markeerColliNietGevonden(args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickronde'] })
    },
  })
}

// Mig 518: "Toch gevonden" — zet een op niet-gevonden gezette colli terug op
// 'open'. Zelfde cache-invalidatie als de niet-gevonden-mutatie.
export function useHerstelColli() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (zendingColliId: number) => herstelColli(zendingColliId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickronde'] })
    },
  })
}

export function useAnnuleerPickronde() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ zendingId, reden }: { zendingId: number; reden?: string | null }) =>
      annuleerPickronde(zendingId, reden),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickronde'] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'zendingen'] })
      qc.invalidateQueries({ queryKey: ['pick-ship'] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      // Order valt terug uit de actieve bundel → preview herevalueren (mig 229).
      qc.invalidateQueries({ queryKey: ['voorgestelde-bundels'] })
    },
  })
}

export function useVoltooiPickronde() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ zendingId, pickerId }: { zendingId: number; pickerId: number | null }) =>
      voltooiPickronde(zendingId, pickerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickronde'] })
      // ADR-0012: useZendingen gebruikt prefix ['logistiek', 'zendingen'];
      // ['zendingen'] zonder de logistiek-prefix matcht niets in React Query's
      // prefix-match en liet de /logistiek-lijst tot 30s wachten op de poll-tick.
      qc.invalidateQueries({ queryKey: ['logistiek', 'zendingen'] })
      qc.invalidateQueries({ queryKey: ['pick-ship'] })
      // Factuur-keten kan vuren na voltooi (mig 217 sluit orders.status='Verzonden')
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['facturen'] })
    },
  })
}

// Mig 412: bulk-afronden van meerdere pickrondes tegelijk vanaf Pick & Ship.
// Zelfde cache-invalidatie als useVoltooiPickronde + voorgestelde-bundels (de
// afgeronde orders vallen uit de bundel-preview, mig 229).
export function useVoltooiPickrondes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ zendingIds, pickerId }: { zendingIds: number[]; pickerId: number | null }) =>
      voltooiPickrondes(zendingIds, pickerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickronde'] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'zendingen'] })
      qc.invalidateQueries({ queryKey: ['pick-ship'] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['facturen'] })
      qc.invalidateQueries({ queryKey: ['voorgestelde-bundels'] })
    },
  })
}
