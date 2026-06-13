import { useQuery } from '@tanstack/react-query'
import { fetchLatestShopifySyncRun } from '@/lib/supabase/queries/shopify-sync'

/**
 * Status van de geplande Shopify-orderpoll (mig 323, draait elke 10 min).
 * Pollt mee zodat een net-misgelopen run snel zichtbaar wordt op het orders-overzicht.
 */
export function useLatestShopifySyncRun() {
  return useQuery({
    queryKey: ['shopify-sync', 'latest-run'],
    queryFn: fetchLatestShopifySyncRun,
    refetchInterval: 60_000,
  })
}
