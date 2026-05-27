import { useQuery } from '@tanstack/react-query'
import {
  fetchZendingStickerData,
  fetchZendingStickerDataBulk,
  type ZendingRegelStickerData,
} from '@/modules/logistiek/queries/zending-stickers'

/** Tapijt-sticker-data voor 1 zending (mig 303). */
export function useZendingStickerData(zendingId: number | null | undefined) {
  return useQuery({
    queryKey: ['logistiek', 'zending-sticker', zendingId],
    queryFn: () => fetchZendingStickerData(zendingId!),
    enabled: !!zendingId,
  })
}

/** Bulk-variant — 1 query voor N zendingen. Sorted ids in queryKey voor cache-stabiliteit. */
export function useZendingStickerDataBulk(zendingIds: number[]) {
  const sorted = [...zendingIds].sort((a, b) => a - b)
  return useQuery({
    queryKey: ['logistiek', 'zending-sticker', 'bulk', sorted],
    queryFn: () => fetchZendingStickerDataBulk(sorted),
    enabled: sorted.length > 0,
  })
}

export type { ZendingRegelStickerData }
