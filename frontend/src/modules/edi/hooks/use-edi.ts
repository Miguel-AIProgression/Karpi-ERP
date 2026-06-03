import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchEdiBerichten,
  fetchEdiBericht,
  fetchHandelspartnerConfig,
  upsertHandelspartnerConfig,
  fetchEdiPartners,
  fetchDebiteurenVoorKoppeling,
  koppelEdiAfleveradres,
  type EdiBerichtenFilters,
  type EdiHandelspartnerConfig,
} from '@/modules/edi/queries/edi'
import { fetchAfleveradressen } from '@/modules/debiteuren/queries/debiteuren'

export function useEdiPartners() {
  return useQuery({
    queryKey: ['edi-partners'],
    queryFn: fetchEdiPartners,
    staleTime: 60_000,
  })
}

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

export function useDebiteurenVoorKoppeling(zoek: string) {
  return useQuery({
    queryKey: ['edi-koppel-debiteuren', zoek],
    queryFn: () => fetchDebiteurenVoorKoppeling(zoek),
    staleTime: 30_000,
  })
}

export function useAfleveradressenVoorKoppeling(debiteurNr: number | undefined) {
  return useQuery({
    queryKey: ['edi-koppel-afleveradressen', debiteurNr],
    queryFn: () => fetchAfleveradressen(debiteurNr!),
    enabled: !!debiteurNr,
  })
}

export function useKoppelEdiAfleveradres() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { berichtId: number; debiteurNr: number; afleveradresId: number }) =>
      koppelEdiAfleveradres(vars.berichtId, vars.debiteurNr, vars.afleveradresId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['edi-berichten'] })
    },
  })
}
