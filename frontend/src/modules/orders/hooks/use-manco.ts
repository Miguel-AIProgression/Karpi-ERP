import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMancoRegels, mancoNietLeverbaar, mancoTerugNaarPickship } from '../queries/manco'

export function useMancoRegels() {
  return useQuery({ queryKey: ['manco'], queryFn: fetchMancoRegels, staleTime: 30_000 })
}

function useMancoInvalidatie() {
  const qc = useQueryClient()
  // Werklijst + orders-overzicht (status kan flippen) + Pick & Ship (regel komt
  // terug bij 'weer beschikbaar' / NL-backorder). ['orders'] dekt ook de tellers.
  return () => {
    qc.invalidateQueries({ queryKey: ['manco'] })
    qc.invalidateQueries({ queryKey: ['orders'] })
    qc.invalidateQueries({ queryKey: ['pick-ship'] })
  }
}

export function useMancoTerugNaarPickship() {
  const invalidate = useMancoInvalidatie()
  return useMutation({
    mutationFn: ({ orderRegelId }: { orderRegelId: number }) => mancoTerugNaarPickship(orderRegelId),
    onSuccess: invalidate,
  })
}

export function useMancoNietLeverbaar() {
  const invalidate = useMancoInvalidatie()
  return useMutation({
    mutationFn: ({
      orderRegelId,
      corrigeerVoorraad,
      reden,
    }: {
      orderRegelId: number
      corrigeerVoorraad: boolean
      reden?: string | null
    }) => mancoNietLeverbaar(orderRegelId, corrigeerVoorraad, reden ?? null),
    onSuccess: invalidate,
  })
}
