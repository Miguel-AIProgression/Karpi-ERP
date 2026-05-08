import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchVerzendregelsVoorVervoerder,
  fetchAlleVerzendregels,
  createVerzendregel,
  updateVerzendregel,
  deleteVerzendregel,
  type VerzendregelInput,
} from '@/modules/logistiek/queries/verzendregels'

const STALE_5_MIN = 5 * 60_000

export function useVerzendregelsVoorVervoerder(vervoerderCode: string | undefined) {
  return useQuery({
    queryKey: ['logistiek', 'verzendregels', 'vervoerder', vervoerderCode],
    queryFn: () => fetchVerzendregelsVoorVervoerder(vervoerderCode!),
    enabled: !!vervoerderCode,
    staleTime: STALE_5_MIN,
  })
}

export function useAlleVerzendregels() {
  return useQuery({
    queryKey: ['logistiek', 'verzendregels', 'all'],
    queryFn: () => fetchAlleVerzendregels(),
    staleTime: STALE_5_MIN,
  })
}

function invalidateVerzendregels(qc: ReturnType<typeof useQueryClient>) {
  // Parent-key invalidatie raakt zowel de centrale lijst (`...,'all'`) als alle
  // per-vervoerder caches (`...,'vervoerder',<code>`) in één klap.
  qc.invalidateQueries({ queryKey: ['logistiek', 'verzendregels'] })
}

export function useCreateVerzendregel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: VerzendregelInput) => createVerzendregel(input),
    onSuccess: () => invalidateVerzendregels(qc),
  })
}

export function useUpdateVerzendregel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: number
      patch: Partial<VerzendregelInput>
    }) => updateVerzendregel(id, patch),
    onSuccess: () => invalidateVerzendregels(qc),
  })
}

export function useDeleteVerzendregel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: number }) => deleteVerzendregel(id),
    onSuccess: () => invalidateVerzendregels(qc),
  })
}
