import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchUitwisselbareGroepen,
  fetchKoppelbareKwaliteiten,
  createUitwisselbareGroep,
  hernoemUitwisselbareGroep,
  updateUitwisselbareGroepLeden,
} from '@/lib/supabase/queries/uitwisselbaar'

export function useUitwisselbareGroepen() {
  return useQuery({
    queryKey: ['uitwisselbare-groepen'],
    queryFn: fetchUitwisselbareGroepen,
    staleTime: 5 * 60 * 1000,
  })
}

export function useKoppelbareKwaliteiten() {
  return useQuery({
    queryKey: ['uitwisselbare-groepen', 'koppelbare-kwaliteiten'],
    queryFn: fetchKoppelbareKwaliteiten,
    staleTime: 5 * 60 * 1000,
  })
}

function invalidateGroepen(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['uitwisselbare-groepen'] })
}

export function useCreateUitwisselbareGroep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ naam, kwaliteitCodes }: { naam: string; kwaliteitCodes: string[] }) =>
      createUitwisselbareGroep(naam, kwaliteitCodes),
    onSuccess: () => invalidateGroepen(qc),
  })
}

export function useHernoemUitwisselbareGroep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ collectieId, naam }: { collectieId: number; naam: string }) =>
      hernoemUitwisselbareGroep(collectieId, naam),
    onSuccess: () => invalidateGroepen(qc),
  })
}

export function useUpdateUitwisselbareGroepLeden() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      collectieId,
      toevoegen,
      verwijderen,
    }: {
      collectieId: number
      toevoegen: string[]
      verwijderen: string[]
    }) => updateUitwisselbareGroepLeden(collectieId, toevoegen, verwijderen),
    onSuccess: () => invalidateGroepen(qc),
  })
}
