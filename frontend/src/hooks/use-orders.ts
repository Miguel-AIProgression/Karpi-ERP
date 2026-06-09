import { useQuery } from '@tanstack/react-query'
import {
  fetchOrders,
  fetchStatusCounts,
  fetchOrderDetail,
  fetchOrderRegels,
  fetchOrderKlantOpties,
  countTeBevestigenDebiteurOrders,
} from '@/lib/supabase/queries/orders'
import type { OrderSortField, SortDirection } from '@/lib/supabase/queries/orders'

export function useOrders(params: {
  status?: string
  search?: string
  debiteurNr?: number
  debiteurNrs?: number[]
  bronSystemen?: string[]
  page?: number
  pageSize?: number
  sortBy?: OrderSortField
  sortDir?: SortDirection
}) {
  return useQuery({
    queryKey: ['orders', params],
    queryFn: () => fetchOrders(params),
  })
}

export function useStatusCounts() {
  return useQuery({
    queryKey: ['orders', 'status-counts'],
    queryFn: fetchStatusCounts,
  })
}

export function useOrderKlantOpties() {
  return useQuery({
    queryKey: ['orders', 'klant-opties'],
    queryFn: fetchOrderKlantOpties,
    staleTime: 60_000,
  })
}

export function useOrderDetail(id: number) {
  return useQuery({
    queryKey: ['orders', id],
    queryFn: () => fetchOrderDetail(id),
    enabled: id > 0,
  })
}

export function useOrderRegels(orderId: number) {
  return useQuery({
    queryKey: ['orders', orderId, 'regels'],
    queryFn: () => fetchOrderRegels(orderId),
    enabled: orderId > 0,
  })
}

/**
 * Aantal orders met een onzekere (fuzzy) debiteur-match die nog bevestigd moet
 * worden (mig 322). Voedt de waarschuwingsbanner op het orders-overzicht.
 */
export function useTeBevestigenDebiteurCount() {
  return useQuery({
    queryKey: ['orders', 'debiteur-te-bevestigen-count'],
    queryFn: countTeBevestigenDebiteurOrders,
    refetchInterval: 60_000,
  })
}
