import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchVervoerders,
  fetchVervoerder,
  fetchVervoerderStats,
  fetchRecenteZendingenVervoerder,
  updateVervoerder,
  type VervoerderUpdateInput,
} from '@/modules/logistiek/queries/vervoerders'

const STALE_5_MIN = 5 * 60_000

export function useVervoerders() {
  return useQuery({
    queryKey: ['logistiek', 'vervoerders', 'list'],
    queryFn: () => fetchVervoerders(),
    staleTime: STALE_5_MIN,
  })
}

export function useVervoerder(code: string | undefined) {
  return useQuery({
    queryKey: ['logistiek', 'vervoerder', code],
    queryFn: () => fetchVervoerder(code!),
    enabled: !!code,
    staleTime: STALE_5_MIN,
  })
}

export function useVervoerderStats() {
  return useQuery({
    queryKey: ['logistiek', 'vervoerder-stats'],
    queryFn: () => fetchVervoerderStats(),
    staleTime: 60_000,
  })
}

export function useRecenteZendingenVervoerder(code: string | undefined, limit = 10) {
  return useQuery({
    queryKey: ['logistiek', 'vervoerder-recente-zendingen', code, limit],
    queryFn: () => fetchRecenteZendingenVervoerder(code!, limit),
    enabled: !!code,
    staleTime: 30_000,
  })
}

export function useUpdateVervoerder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ code, data }: { code: string; data: VervoerderUpdateInput }) =>
      updateVervoerder(code, data),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['logistiek', 'vervoerder', vars.code] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'vervoerders', 'list'] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'vervoerder-stats'] })
      // De oude lichtgewicht hook in `use-vervoerder-config.ts` cached ook onder
      // ['logistiek', 'vervoerders'] — gooi die ook leeg zodat dropdowns updaten.
      qc.invalidateQueries({ queryKey: ['logistiek', 'vervoerders'] })
    },
  })
}
