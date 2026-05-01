import { useQuery } from '@tanstack/react-query'
import {
  fetchKlanten,
  fetchKlantDetail,
  fetchAfleveradressen,
  fetchKlanteigenNamen,
  fetchKlantArtikelnummers,
  fetchKlantPrijslijst,
  fetchVertegenwoordigers,
} from '@/lib/supabase/queries/klanten'

export function useKlanten(params: {
  search?: string
  status?: string
  tier?: string
  vertegenw_code?: string
  edi_filter?: 'edi' | 'niet_edi'
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
