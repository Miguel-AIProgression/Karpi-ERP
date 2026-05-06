import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  deleteVorm,
  fetchAlleVormen,
  upsertVorm,
  type MaatwerkVormRow,
} from '@/lib/supabase/queries/op-maat'

export function useAlleVormen() {
  return useQuery({
    queryKey: ['maatwerk-vormen', 'alle'],
    queryFn: fetchAlleVormen,
  })
}

export function useUpsertVorm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vorm: Omit<MaatwerkVormRow, 'id'> & { id?: number }) => upsertVorm(vorm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maatwerk-vormen'] })
    },
  })
}

export function useDeleteVorm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteVorm(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maatwerk-vormen'] })
    },
  })
}
