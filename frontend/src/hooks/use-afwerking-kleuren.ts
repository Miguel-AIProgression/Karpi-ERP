import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  deleteAfwerkingKleur,
  fetchActieveAfwerkingKleuren,
  fetchAfwerkingKleuren,
  upsertAfwerkingKleur,
  type AfwerkingKleurRow,
} from '@/lib/supabase/queries/afwerking-kleuren'

const QK = (afwerkingCode: string) => ['afwerking-kleuren', afwerkingCode] as const
const QK_ACTIEF = (afwerkingCode: string) => ['afwerking-kleuren', afwerkingCode, 'actief'] as const

export function useAfwerkingKleuren(afwerkingCode: string | null | undefined) {
  return useQuery({
    queryKey: QK(afwerkingCode ?? ''),
    queryFn: () => fetchAfwerkingKleuren(afwerkingCode!),
    enabled: !!afwerkingCode,
  })
}

export function useActieveAfwerkingKleuren(afwerkingCode: string | null | undefined) {
  return useQuery({
    queryKey: QK_ACTIEF(afwerkingCode ?? ''),
    queryFn: () => fetchActieveAfwerkingKleuren(afwerkingCode!),
    enabled: !!afwerkingCode,
  })
}

export function useUpsertAfwerkingKleur() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (row: Omit<AfwerkingKleurRow, 'id'> & { id?: number }) => upsertAfwerkingKleur(row),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['afwerking-kleuren', saved.afwerking_code] })
    },
  })
}

export function useDeleteAfwerkingKleur(afwerkingCode: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteAfwerkingKleur(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['afwerking-kleuren', afwerkingCode] })
    },
  })
}
