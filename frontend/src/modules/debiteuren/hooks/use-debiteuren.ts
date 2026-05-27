import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchDebiteuren,
  fetchDebiteurDetail,
  fetchAfleveradressen,
  fetchKoppelbareDebiteurenMetPrijslijst,
} from '../queries/debiteuren'
import { fetchKlantArtikelnummers } from '../queries/klant-artikelnummers'
import {
  fetchKlantPrijslijst,
  fetchPrijslijstHeadersList,
  setKlantPrijslijst,
  setKlantenPrijslijst,
} from '../queries/debiteur-prijslijst'

export function useDebiteuren(params: {
  search?: string
  status?: string
  tier?: string
  vertegenw_code?: string
  edi_filter?: 'edi' | 'niet_edi'
  inkoopgroep_code?: string
  prijslijst_filter?: string | 'geen'
  page?: number
  pageSize?: number
}) {
  return useQuery({
    queryKey: ['klanten', params],
    queryFn: () => fetchDebiteuren(params),
  })
}

export function useDebiteurDetail(debiteurNr: number) {
  return useQuery({
    queryKey: ['klanten', debiteurNr],
    queryFn: () => fetchDebiteurDetail(debiteurNr),
    enabled: debiteurNr > 0,
  })
}

export function useAfleveradressen(debiteurNr: number) {
  return useQuery({
    queryKey: ['klanten', debiteurNr, 'afleveradressen'],
    queryFn: () => fetchAfleveradressen(debiteurNr),
    enabled: debiteurNr > 0,
  })
}

export function useKlantArtikelnummers(debiteurNr: number) {
  return useQuery({
    queryKey: ['klanten', debiteurNr, 'klant-artikelnummers'],
    queryFn: () => fetchKlantArtikelnummers(debiteurNr),
    enabled: debiteurNr > 0,
  })
}

export function useKlantPrijslijst(debiteurNr: number) {
  return useQuery({
    queryKey: ['klanten', debiteurNr, 'prijslijst'],
    queryFn: () => fetchKlantPrijslijst(debiteurNr),
    enabled: debiteurNr > 0,
  })
}

export function usePrijslijstHeadersList() {
  return useQuery({
    queryKey: ['prijslijst-headers-list'],
    queryFn: fetchPrijslijstHeadersList,
  })
}

export function useKoppelbareDebiteurenMetPrijslijst() {
  return useQuery({
    queryKey: ['klanten', 'koppelbare-met-prijslijst'],
    queryFn: fetchKoppelbareDebiteurenMetPrijslijst,
  })
}

export function useSetKlantPrijslijst() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ debiteurNr, prijslijstNr }: { debiteurNr: number; prijslijstNr: string | null }) =>
      setKlantPrijslijst(debiteurNr, prijslijstNr),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['klanten'] })
      qc.invalidateQueries({ queryKey: ['klanten', vars.debiteurNr] })
      qc.invalidateQueries({ queryKey: ['prijslijsten'] })
    },
  })
}

export function useSetKlantenPrijslijst() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ debiteurNrs, prijslijstNr }: { debiteurNrs: number[]; prijslijstNr: string | null }) =>
      setKlantenPrijslijst(debiteurNrs, prijslijstNr),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['klanten'] })
      qc.invalidateQueries({ queryKey: ['prijslijsten'] })
    },
  })
}
