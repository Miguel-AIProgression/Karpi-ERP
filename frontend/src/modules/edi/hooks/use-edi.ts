import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchEdiBerichten,
  fetchEdiBericht,
  fetchHandelspartnerConfig,
  upsertHandelspartnerConfig,
  type EdiBerichtenFilters,
  type EdiHandelspartnerConfig,
} from '@/modules/edi/queries/edi'

export function useEdiBerichten(filters: EdiBerichtenFilters = {}) {
  return useQuery({
    queryKey: ['edi-berichten', filters],
    queryFn: () => fetchEdiBerichten(filters),
    refetchInterval: 30_000, // poll elke 30s zodat nieuwe inkomende berichten zichtbaar worden
  })
}

export function useEdiBericht(id: number | undefined) {
  return useQuery({
    queryKey: ['edi-berichten', 'detail', id],
    queryFn: () => fetchEdiBericht(id!),
    enabled: !!id,
  })
}

export function useHandelspartnerConfig(debiteurNr: number | undefined) {
  return useQuery({
    queryKey: ['edi-handelspartner-config', debiteurNr],
    queryFn: () => fetchHandelspartnerConfig(debiteurNr!),
    enabled: !!debiteurNr,
  })
}

export function useUpsertHandelspartnerConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cfg: Omit<EdiHandelspartnerConfig, 'created_at' | 'updated_at'>) =>
      upsertHandelspartnerConfig(cfg),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['edi-handelspartner-config', vars.debiteur_nr] })
    },
  })
}
