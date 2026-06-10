import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createBugMelding,
  fetchBugMeldingen,
  markeerVerwerktGezien,
  setBugStatus,
  type BugMelding,
  type BugMeldingStatus,
  type NieuweBugMelding,
  type VerwerktNotitie,
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
    mutationFn: ({
      id,
      status,
      notitie,
    }: {
      id: number
      status: BugMeldingStatus
      notitie?: VerwerktNotitie
    }) => setBugStatus(id, status, notitie),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useMarkeerVerwerktGezien() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: markeerVerwerktGezien,
    onSuccess: (aantal) => {
      if (aantal > 0) qc.invalidateQueries({ queryKey: KEY })
    },
  })
}

/**
 * Aantal eigen meldingen die verwerkt zijn maar nog niet gezien — voedt de
 * teller op het belletje rechtsboven. Hergebruikt de gecachte meldingen-query.
 */
export function isVerwerktOngezien(melding: BugMelding, userId: string | undefined): boolean {
  return (
    melding.gemeld_door === userId &&
    melding.status === 'Verwerkt' &&
    melding.verwerkt_gezien_op === null
  )
}
