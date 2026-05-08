import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { previewVervoerderVoorOrder } from '../queries/verzendregels'
import { useActieveVervoerder } from './use-vervoerders'

export interface OrderMinimaalVoorVervoerder {
  order_id: number
  debiteur_nr: number
  afhalen: boolean
}

export interface ResolvedVervoerder {
  /** Effectieve vervoerder-code, of `null` als geen (incl. afhalen). */
  code: string | null
  /** TRUE als order op afhalen staat — geen vervoerder maar wel een filter-keuze. */
  afhalen: boolean
}

const STALE_30_SEC = 30_000

/**
 * Effectieve vervoerder per order — page-level resolver met dezelfde precedentie
 * als `VervoerderInlineSelect`: regel-preview > klant-fallback > globaal-actief.
 *
 * Cache-deelt met de inline-select-queries via dezelfde
 * `['logistiek', 'vervoerder-preview', orderId]`-keys, zodat het page-filter en
 * de pickronde-cards dezelfde data zien zonder dubbele round-trips.
 *
 * Klant-config wordt ééns ge-batched opgehaald voor alle unieke debiteur_nrs;
 * dat is naast de N losse `useKlantVervoerderConfig`-aanroepen die de cards al
 * doen, maar voorkomt dat het page-filter zelf N extra queries triggert vóór de
 * cards mounten.
 */
export function useVervoerderPerOrder(
  orders: OrderMinimaalVoorVervoerder[],
): { map: Map<number, ResolvedVervoerder>; isLoading: boolean } {
  const debiteurKey = useMemo(
    () => Array.from(new Set(orders.map((o) => o.debiteur_nr))).sort((a, b) => a - b),
    [orders],
  )

  const klantConfigQuery = useQuery({
    queryKey: ['logistiek', 'vervoerder-config-batch', debiteurKey],
    queryFn: async () => {
      if (debiteurKey.length === 0) return new Map<number, string | null>()
      const { data, error } = await supabase
        .from('edi_handelspartner_config')
        .select('debiteur_nr, vervoerder_code')
        .in('debiteur_nr', debiteurKey)
      if (error) throw error
      const m = new Map<number, string | null>()
      for (const row of (data ?? []) as Array<{
        debiteur_nr: number
        vervoerder_code: string | null
      }>) {
        m.set(row.debiteur_nr, row.vervoerder_code)
      }
      return m
    },
    enabled: debiteurKey.length > 0,
    staleTime: STALE_30_SEC,
  })

  const previewableOrders = useMemo(() => orders.filter((o) => !o.afhalen), [orders])

  const previewQueries = useQueries({
    queries: previewableOrders.map((o) => ({
      queryKey: ['logistiek', 'vervoerder-preview', o.order_id],
      queryFn: () => previewVervoerderVoorOrder(o.order_id),
      staleTime: STALE_30_SEC,
    })),
  })

  const actief = useActieveVervoerder()

  const map = useMemo(() => {
    const klant = klantConfigQuery.data ?? new Map<number, string | null>()
    const preview = new Map<number, string | null>()
    previewableOrders.forEach((o, i) => {
      preview.set(o.order_id, previewQueries[i]?.data?.gekozen_vervoerder_code ?? null)
    })
    const result = new Map<number, ResolvedVervoerder>()
    for (const o of orders) {
      if (o.afhalen) {
        result.set(o.order_id, { code: null, afhalen: true })
        continue
      }
      const klantCode = klant.get(o.debiteur_nr) ?? null
      const previewCode = preview.get(o.order_id) ?? null
      const code = previewCode ?? klantCode ?? actief.code ?? null
      result.set(o.order_id, { code, afhalen: false })
    }
    return result
  }, [orders, previewableOrders, previewQueries, klantConfigQuery.data, actief.code])

  const isLoading =
    klantConfigQuery.isLoading || previewQueries.some((q) => q.isLoading) || actief.isLoading

  return { map, isLoading }
}
