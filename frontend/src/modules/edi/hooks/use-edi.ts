import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchEdiBerichten,
  fetchEdiBericht,
  countTeKoppelenEdiOrders,
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

/**
 * Aantal inkomende EDI-orders die nog gekoppeld moeten worden (order_id IS NULL).
 * Voedt de waarschuwingsbanner op het orders-overzicht. Pollt mee met de
 * berichten-lijst (30s) zodat een net-binnengekomen ongematchte order snel opvalt.
 */
export function useTeKoppelenEdiCount() {
  return useQuery({
    queryKey: ['edi-te-koppelen-count'],
    queryFn: countTeKoppelenEdiOrders,
    refetchInterval: 30_000,
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
      // Banner op orders-overzicht moet meteen meebewegen als er gekoppeld is.
      qc.invalidateQueries({ queryKey: ['edi-te-koppelen-count'] })
    },
  })
}
