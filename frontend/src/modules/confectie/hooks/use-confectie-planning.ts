import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  afrondConfectie,
  fetchConfectiePlanning,
  fetchConfectiePlanningForward,
  fetchConfectieWerktijden,
  startConfectie,
  updateConfectieWerktijd,
  type AfrondConfectieInput,
  type ConfectieWerktijd,
} from '../queries/confectie-planning'
import { invalidateNaConfectieMutatie } from '../cache'

export function useConfectiePlanning() {
  return useQuery({
    queryKey: ['confectie-planning'],
    queryFn: fetchConfectiePlanning,
  })
}

export function useConfectieWerktijden() {
  return useQuery({
    queryKey: ['confectie-werktijden'],
    queryFn: fetchConfectieWerktijden,
  })
}

export function useAfrondConfectie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AfrondConfectieInput) => afrondConfectie(input),
    onSuccess: () => {
      invalidateNaConfectieMutatie(qc)
      // Snijplanning leest niet rechtstreeks confectie-status, maar `snijplannen.status`
      // flipt naar 'Ingepakt'/'In confectie' via de RPC — dus snijplanning-views moeten
      // ook refreshen. Producer-Module-import zou hier cycle creëren; inline blijft.
      qc.invalidateQueries({ queryKey: ['snijplanning'] })
      // Magazijn-pickbaarheid leest `snijplannen.status='Ingepakt'` (mig 170) —
      // wanneer voltooi_confectie p_ingepakt=true zet, moet Pick & Ship het stuk
      // direct kunnen ophalen zonder hard refresh.
      qc.invalidateQueries({ queryKey: ['magazijn'] })
    },
  })
}

export function useStartConfectie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (snijplanId: number) => startConfectie(snijplanId),
    onSuccess: () => {
      invalidateNaConfectieMutatie(qc)
      qc.invalidateQueries({ queryKey: ['snijplanning'] })
    },
  })
}

export function useUpdateConfectieWerktijd() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      type_bewerking,
      velden,
    }: {
      type_bewerking: string
      velden: Partial<Pick<ConfectieWerktijd, 'minuten_per_meter' | 'wisseltijd_minuten' | 'actief'>>
    }) => updateConfectieWerktijd(type_bewerking, velden),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['confectie-werktijden'] })
    },
  })
}

export function useConfectiePlanningForward() {
  return useQuery({
    queryKey: ['confectie', 'planning-forward'],
    queryFn: fetchConfectiePlanningForward,
    staleTime: 30_000,
  })
}
