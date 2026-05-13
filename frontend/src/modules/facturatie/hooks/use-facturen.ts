import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchFacturen,
  fetchFactuurDetail,
  fetchFacturenVoorOrder,
  fetchFacturenVoorOrders,
  zetFactuurOpBetaald,
  fetchBundelInfoVoorFactuur,
} from '../queries/facturen'

export function useFacturen(debiteurNr?: number) {
  return useQuery({
    queryKey: ['facturen', debiteurNr ?? 'all'],
    queryFn: () => fetchFacturen({ debiteurNr }),
  })
}

export function useFactuurDetail(id: number | undefined) {
  return useQuery({
    queryKey: ['facturen', 'detail', id],
    queryFn: () => fetchFactuurDetail(id!),
    enabled: !!id,
  })
}

export function useFacturenVoorOrder(orderId: number | undefined) {
  return useQuery({
    queryKey: ['facturen', 'voor-order', orderId],
    queryFn: () => fetchFacturenVoorOrder(orderId!),
    enabled: !!orderId,
  })
}

export function useFacturenVoorOrders(orderIds: number[]) {
  const sleutel = [...orderIds].sort((a, b) => a - b).join(',')
  return useQuery({
    queryKey: ['facturen', 'voor-orders', sleutel],
    queryFn: () => fetchFacturenVoorOrders(orderIds),
    enabled: orderIds.length > 0,
  })
}

export function useMarkeerBetaald() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: zetFactuurOpBetaald,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['facturen'] }),
  })
}

export function useBundelInfoVoorFactuur(factuurId: number | null | undefined) {
  return useQuery({
    queryKey: ['bundel-info-factuur', factuurId],
    queryFn: () => fetchBundelInfoVoorFactuur(factuurId as number),
    enabled: Boolean(factuurId),
    staleTime: 60_000,
  })
}
