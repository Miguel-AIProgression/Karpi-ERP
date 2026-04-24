import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchFacturen,
  fetchFactuurDetail,
  zetFactuurOpBetaald,
} from '@/lib/supabase/queries/facturen'

export function useFacturen(debiteurNr?: number) {
  return useQuery({
    queryKey: ['facturen', debiteurNr ?? 'all'],
    queryFn: () => fetchFacturen({ debiteurNr }),
  })
}

export function useFactuurDetail(id: number | undefined) {
  return useQuery({
    queryKey: ['facturen', 'detail', id],
    queryFn: () => fetchFactuurDetail(id!),
    enabled: !!id,
  })
}

export function useMarkeerBetaald() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: zetFactuurOpBetaald,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['facturen'] }),
  })
}
