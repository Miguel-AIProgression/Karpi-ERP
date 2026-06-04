import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchGebruikers,
  uitnodigenGebruiker,
  genereerLoginLink,
  wachtwoordResetGebruiker,
  blokkeerGebruiker,
  verwijderGebruiker,
} from '@/lib/supabase/queries/gebruikers'

const GEBRUIKERS_KEY = ['gebruikers'] as const

export function useGebruikers() {
  return useQuery({
    queryKey: GEBRUIKERS_KEY,
    queryFn: fetchGebruikers,
  })
}

export function useUitnodigenGebruiker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (email: string) => uitnodigenGebruiker(email),
    onSuccess: () => qc.invalidateQueries({ queryKey: GEBRUIKERS_KEY }),
  })
}

export function useWachtwoordReset() {
  return useMutation({
    mutationFn: (email: string) => wachtwoordResetGebruiker(email),
  })
}

export function useGenereerLoginLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (email: string) => genereerLoginLink(email),
    // Een invite-link maakt het account aan → ververs de lijst.
    onSuccess: () => qc.invalidateQueries({ queryKey: GEBRUIKERS_KEY }),
  })
}

export function useBlokkeerGebruiker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, blokkeren }: { id: string; blokkeren: boolean }) =>
      blokkeerGebruiker(id, blokkeren),
    onSuccess: () => qc.invalidateQueries({ queryKey: GEBRUIKERS_KEY }),
  })
}

export function useVerwijderGebruiker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => verwijderGebruiker(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: GEBRUIKERS_KEY }),
  })
}
