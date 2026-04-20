import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  afrondConfectie,
  fetchConfectiePlanning,
  fetchConfectiePlanningForward,
  fetchConfectieWerktijden,
  updateConfectieWerktijd,
  type AfrondConfectieInput,
  type ConfectieWerktijd,
} from '@/lib/supabase/queries/confectie-planning'

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
      qc.invalidateQueries({ queryKey: ['confectie-planning'] })
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
