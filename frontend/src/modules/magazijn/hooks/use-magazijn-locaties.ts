import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createOrGetMagazijnLocatie,
  fetchMagazijnLocaties,
} from '../queries/magazijn-locaties'

export function useMagazijnLocaties() {
  return useQuery({
    queryKey: ['magazijn-locaties'],
    queryFn: fetchMagazijnLocaties,
    staleTime: 60_000,
  })
}

export function useCreateOrGetMagazijnLocatie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createOrGetMagazijnLocatie,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['magazijn-locaties'] }),
  })
}
