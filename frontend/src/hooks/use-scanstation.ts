import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  lookupScancode,
  logScanEvent,
  fetchOpenstaandItems,
  opboekenItem,
} from '@/lib/supabase/queries/scanstation'
import type { ScanActie } from '@/lib/types/productie'
import { invalidateNaSnijplanMutatie } from '@/modules/snijplanning'
import { invalidateNaConfectieMutatie } from '@/modules/confectie'

export function useLookupScancode() {
  return useMutation({
    mutationFn: (scancode: string) => lookupScancode(scancode),
  })
}

export function useLogScanEvent() {
  return useMutation({
    mutationFn: (params: { scancode: string; actie: ScanActie; station: string; medewerker?: string }) =>
      logScanEvent(params.scancode, params.actie, params.station, params.medewerker),
  })
}

export function useOpenstaandItems() {
  return useQuery({
    queryKey: ['scanstation', 'openstaand'],
    queryFn: fetchOpenstaandItems,
    refetchInterval: 30_000, // auto-refresh every 30s
  })
}

export function useOpboekenItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (snijplanId: number) => opboekenItem(snijplanId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scanstation'] })
      invalidateNaSnijplanMutatie(qc)
      invalidateNaConfectieMutatie(qc)
    },
  })
}
