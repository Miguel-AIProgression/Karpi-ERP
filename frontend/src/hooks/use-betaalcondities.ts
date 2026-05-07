import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchBetaalcondities,
  fetchActieveBetaalcondities,
  fetchKlantenVoorBetaalconditie,
  upsertBetaalconditie,
  deleteBetaalconditie,
  bulkSetBetaalconditie,
  type BetaalconditieInput,
} from '@/lib/supabase/queries/betaalcondities'

const KEY = ['betaalcondities'] as const

/** Alle betaalcondities incl. inactief + aantal_klanten — voor de instellingen-pagina. */
export function useBetaalcondities() {
  return useQuery({ queryKey: KEY, queryFn: fetchBetaalcondities })
}

/** Alleen actieve betaalcondities — voor dropdowns. */
export function useActieveBetaalcondities() {
  return useQuery({
    queryKey: [...KEY, 'actief'],
    queryFn: fetchActieveBetaalcondities,
  })
}

/** Klanten die deze betaalconditie gebruiken — voor de instellingen-modal. */
export function useKlantenVoorBetaalconditie(code: string | null) {
  return useQuery({
    queryKey: [...KEY, 'klanten', code],
    queryFn: () => fetchKlantenVoorBetaalconditie(code!),
    enabled: !!code,
  })
}

export function useUpsertBetaalconditie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BetaalconditieInput) => upsertBetaalconditie(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
    },
  })
}

export function useDeleteBetaalconditie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => deleteBetaalconditie(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
    },
  })
}

export function useBulkSetBetaalconditie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { debiteurNrs: number[]; value: string }) =>
      bulkSetBetaalconditie(args.debiteurNrs, args.value),
    onSuccess: () => {
      // Aantal-klanten + klantenlijsten op de instellingen-pagina herladen.
      qc.invalidateQueries({ queryKey: KEY })
      // Klant-detail pagina's refreshen voor de bewerkte debiteuren.
      qc.invalidateQueries({ queryKey: ['klanten'] })
    },
  })
}
