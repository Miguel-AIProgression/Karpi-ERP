import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createBugMelding,
  fetchBugMeldingen,
  setBugStatus,
  type BugMeldingStatus,
  type NieuweBugMelding,
} from '@/lib/supabase/queries/bug-meldingen'

const KEY = ['bug-meldingen'] as const

export function useBugMeldingen() {
  return useQuery({
    queryKey: KEY,
    queryFn: fetchBugMeldingen,
  })
}

export function useCreateBugMelding() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: NieuweBugMelding) => createBugMelding(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useSetBugStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: BugMeldingStatus }) =>
      setBugStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
