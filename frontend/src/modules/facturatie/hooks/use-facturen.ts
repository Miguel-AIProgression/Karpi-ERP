import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchFacturen,
  fetchFactuurDetail,
  fetchFacturenVoorOrder,
  fetchFacturenVoorOrders,
  zetFactuurOpBetaald,
  zetFactuurStatus,
  zetFactuurStatusBulk,
  fetchBundelInfoVoorFactuur,
  fetchEdiFactuurConfig,
  verstuurFactuurViaEdi,
  markeerBtwRegelingGeaccepteerd,
  countBtwControleNodigFacturen,
  type FactuurStatus,
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

export function useZetFactuurStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: FactuurStatus }) =>
      zetFactuurStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['facturen'] }),
  })
}

export function useZetFactuurStatusBulk() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: FactuurStatus }) =>
      zetFactuurStatusBulk(ids, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['facturen'] }),
  })
}

export function useEdiFactuurConfig(debiteurNr: number | undefined) {
  return useQuery({
    queryKey: ['edi-factuur-config', debiteurNr],
    queryFn: () => fetchEdiFactuurConfig(debiteurNr!),
    enabled: !!debiteurNr,
    staleTime: 5 * 60_000,
  })
}

export function useVerstuurFactuurViaEdi() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: verstuurFactuurViaEdi,
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

export function useMarkeerBtwRegelingGeaccepteerd() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: markeerBtwRegelingGeaccepteerd,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['facturen'] }),
  })
}

export function useBtwControleNodigCount() {
  return useQuery({
    queryKey: ['facturen', 'btw-controle-nodig-count'],
    queryFn: countBtwControleNodigFacturen,
    staleTime: 60_000,
  })
}
