import { useQuery } from '@tanstack/react-query'
import {
  fetchOrders,
  fetchStatusCounts,
  fetchOrderDetail,
  fetchOrderRegels,
} from '@/modules/orders/queries/orders'
import type { OrderSortField, SortDirection } from '@/modules/orders/queries/orders'

export function useOrders(params: {
  status?: string
  search?: string
  debiteurNr?: number
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

/** Publieke alias voor useOrderDetail — voor externe module-consumers. */
export function useOrder(orderId: number) {
  return useOrderDetail(orderId)
}
