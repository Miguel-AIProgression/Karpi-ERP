import { useQuery } from '@tanstack/react-query'
import {
  fetchVertegOverview,
  fetchVertegDetail,
  fetchVertegMaandomzet,
  fetchVertegKlanten,
  fetchVertegOrders,
} from '@/lib/supabase/queries/vertegenwoordigers'

type Periode = 'YTD' | 'Q1' | 'Q2' | 'Q3' | 'Q4'

export function useVertegOverview(periode: Periode = 'YTD') {
  return useQuery({
    queryKey: ['vertegenwoordigers', 'overview', periode],
    queryFn: () => fetchVertegOverview(periode),
  })
}

export function useVertegDetail(code: string) {
  return useQuery({
    queryKey: ['vertegenwoordigers', code],
    queryFn: () => fetchVertegDetail(code),
    enabled: !!code,
  })
}

export function useVertegMaandomzet(code: string) {
  return useQuery({
    queryKey: ['vertegenwoordigers', code, 'maandomzet'],
    queryFn: () => fetchVertegMaandomzet(code),
    enabled: !!code,
  })
}

export function useVertegKlanten(code: string) {
  return useQuery({
    queryKey: ['vertegenwoordigers', code, 'klanten'],
    queryFn: () => fetchVertegKlanten(code),
    enabled: !!code,
  })
}

export function useVertegOrders(code: string, statusFilter?: string) {
  return useQuery({
    queryKey: ['vertegenwoordigers', code, 'orders', statusFilter],
    queryFn: () => fetchVertegOrders(code, statusFilter),
    enabled: !!code,
  })
}
