import { useQuery } from '@tanstack/react-query'
import { fetchKlanten, fetchKlantDetail, fetchAfleveradressen } from '@/lib/supabase/queries/klanten'

export function useKlanten(params: {
  search?: string
  status?: string
  tier?: string
  page?: number
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
