import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchKlanten,
  fetchKlantDetail,
  fetchAfleveradressen,
  fetchKlanteigenNamen,
  fetchKlantArtikelnummers,
  fetchKlantPrijslijst,
  fetchKoppelbareDebiteurenMetPrijslijst,
  fetchPrijslijstHeadersList,
  fetchVertegenwoordigers,
  setKlantPrijslijst,
  setKlantenPrijslijst,
} from '@/lib/supabase/queries/klanten'

export function useKlanten(params: {
  search?: string
  status?: string
  tier?: string
  vertegenw_code?: string
  edi_filter?: 'edi' | 'niet_edi'
  inkoopgroep_code?: string
  page?: number
  pageSize?: number
}) {
  return useQuery({
    queryKey: ['klanten', params],
    queryFn: () => fetchKlanten(params),
  })
}

export function useKlantDetail(debiteurNr: number) {
  return useQuery({
    queryKey: ['klanten', debiteurNr],
    queryFn: () => fetchKlantDetail(debiteurNr),
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

export function useKlanteigenNamen(debiteurNr: number) {
  return useQuery({
    queryKey: ['klanten', debiteurNr, 'klanteigen-namen'],
    queryFn: () => fetchKlanteigenNamen(debiteurNr),
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

export function useVertegenwoordigers() {
  return useQuery({
    queryKey: ['vertegenwoordigers'],
    queryFn: fetchVertegenwoordigers,
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
