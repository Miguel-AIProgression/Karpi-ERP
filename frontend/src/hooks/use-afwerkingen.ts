import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  deleteAfwerkingType,
  fetchAlleAfwerkingTypes,
  fetchTypeBewerkingen,
  upsertAfwerkingType,
  type AfwerkingTypeRow,
} from '@/lib/supabase/queries/op-maat'

export function useAlleAfwerkingen() {
  return useQuery({
    queryKey: ['afwerking-types', 'alle'],
    queryFn: fetchAlleAfwerkingTypes,
  })
}

export function useTypeBewerkingen() {
  return useQuery({
    queryKey: ['confectie-werktijden', 'type-bewerkingen'],
    queryFn: fetchTypeBewerkingen,
  })
}

export function useUpsertAfwerking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (at: Omit<AfwerkingTypeRow, 'id'> & { id?: number }) => upsertAfwerkingType(at),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['afwerking-types'] })
    },
  })
}

export function useDeleteAfwerking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteAfwerkingType(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['afwerking-types'] })
    },
  })
}
