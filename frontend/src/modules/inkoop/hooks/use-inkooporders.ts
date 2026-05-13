import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createInkooporder,
  fetchInkoopRegelSamenvatting,
  fetchInkoopRegelSamenvattingen,
  fetchInkooporderDetail,
  fetchInkooporderRegelContext,
  fetchInkooporders,
  fetchInkooporderStats,
  fetchOpenstaandeInkoopregelsVoorArtikel,
  fetchRollenVoorArtikel,
  fetchRollenVoorStickers,
  updateInkooporderStatus,
  type InkooporderFilters,
  type InkooporderFormData,
  type InkooporderRegelInput,
  type InkooporderStatus,
} from '../queries/inkooporders'
import { invalidateNaInkoopMutatie } from '../cache'

/**
 * Module-interne hooks voor inkooporder-queries en -mutations.
 * Cross-Module-callers importeren deze via de barrel `@/modules/inkoop`.
 *
 * Query-key-conventie: array-prefixed (`['inkooporders', ...]`) zodat de
 * invalidate-helper in cache.ts met `queryKey: ['inkooporders']` alles
 * onder die wortel raakt.
 */

export function useInkooporders(filters: InkooporderFilters = {}) {
  return useQuery({
    queryKey: ['inkooporders', filters],
    queryFn: () => fetchInkooporders(filters),
  })
}

export function useInkooporderDetail(id: number | undefined) {
  return useQuery({
    queryKey: ['inkooporders', 'detail', id],
    queryFn: () => fetchInkooporderDetail(id!),
    enabled: id !== undefined,
    staleTime: 0,
    retry: 1,
  })
}

export function useInkooporderStats() {
  return useQuery({
    queryKey: ['inkooporders', 'stats'],
    queryFn: fetchInkooporderStats,
    staleTime: 60 * 1000,
  })
}

export function useInkooporderRegelContext(artikelnrs: string[]) {
  return useQuery({
    queryKey: ['inkooporders', 'regel-context', [...artikelnrs].sort()],
    queryFn: () => fetchInkooporderRegelContext(artikelnrs),
    enabled: artikelnrs.length > 0,
  })
}

export function useOpenstaandeInkoopregelsVoorArtikel(artikelnr: string | undefined) {
  return useQuery({
    queryKey: ['inkooporders', 'openstaand-per-artikel', artikelnr],
    queryFn: () => fetchOpenstaandeInkoopregelsVoorArtikel(artikelnr!),
    enabled: !!artikelnr,
    staleTime: 30 * 1000,
  })
}

export function useRollenVoorStickers(rolIds: number[]) {
  return useQuery({
    queryKey: ['inkooporders', 'rollen-stickers', [...rolIds].sort()],
    queryFn: () => fetchRollenVoorStickers(rolIds),
    enabled: rolIds.length > 0,
  })
}

export function useRollenVoorArtikel(artikelnr: string | undefined) {
  return useQuery({
    queryKey: ['inkooporders', 'rollen-per-artikel', artikelnr],
    queryFn: () => fetchRollenVoorArtikel(artikelnr!),
    enabled: !!artikelnr,
  })
}

export function useInkoopRegelSamenvatting(ioRegelId: number | undefined) {
  return useQuery({
    queryKey: ['inkooporders', 'regel-samenvatting', ioRegelId],
    queryFn: () => fetchInkoopRegelSamenvatting(ioRegelId!),
    enabled: ioRegelId !== undefined,
    staleTime: 30_000,
  })
}

/**
 * Pre-fetch hook voor cross-Module-callers (bv. Reservering's RegelClaimDetail)
 * die meerdere IO-claim-slots tegelijk willen renderen. Doet één batch-fetch
 * en zet de individuele query-caches via `setQueryData` — de individuele
 * `useInkoopRegelSamenvatting`-hooks lezen daarna uit warme cache zonder
 * eigen round-trip (binnen 30s staleTime).
 *
 * Caller geeft alleen ID's door — kent geen queryKey-vorm van Inkoop's cache.
 */
export function usePrefetchInkoopRegelSamenvattingen(ioRegelIds: number[]) {
  const qc = useQueryClient()
  const idsKey = [...ioRegelIds].sort((a, b) => a - b).join(',')

  useEffect(() => {
    if (ioRegelIds.length === 0) return
    let cancelled = false
    fetchInkoopRegelSamenvattingen(ioRegelIds).then(results => {
      if (cancelled) return
      for (const r of results) {
        qc.setQueryData(['inkooporders', 'regel-samenvatting', r.io_regel_id], r)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, qc])
}

export function useCreateInkooporder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ header, regels }: { header: InkooporderFormData; regels: InkooporderRegelInput[] }) =>
      createInkooporder(header, regels),
    onSuccess: () => invalidateNaInkoopMutatie(qc),
  })
}

export function useUpdateInkooporderStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: InkooporderStatus }) =>
      updateInkooporderStatus(id, status),
    onSuccess: () => invalidateNaInkoopMutatie(qc),
  })
}
