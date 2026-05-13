// React-Query hook rond `levertijd_fit_check` (mig 277). Continu vurende
// fit-check tijdens order-intake: operator typt een gewenste leverweek,
// en deze hook rapporteert per regel of die week haalbaar is.
//
// Debounce (default 300ms) op `gewensteWeek` voorkomt N RPC-calls bij snel
// typen in een week-input. React Query's `staleTime` zorgt voor caching
// over re-renders heen; key bevat `regelIds.sort()` zodat volgorde-mutatie
// geen cache-miss veroorzaakt.

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { fetchFitCheck } from '../queries/levertijd'
import type { FitCheckResultaat } from '../types'

const DEFAULT_DEBOUNCE_MS = 300
const STALE_TIME_MS = 30_000

export interface UseFitCheckOptions {
  /** Debounce-window op `gewensteWeek` in ms. Default 300ms. */
  debounceMs?: number
}

export function useFitCheck(
  regelIds: number[],
  gewensteWeek: string | null,
  options: UseFitCheckOptions = {},
) {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const [debouncedWeek, setDebouncedWeek] = useState<string | null>(gewensteWeek)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedWeek(gewensteWeek), debounceMs)
    return () => clearTimeout(t)
  }, [gewensteWeek, debounceMs])

  // Stabiele cache-key: gesorteerde id-array zodat [1,2] en [2,1] hetzelfde zijn.
  const sortedIds = [...regelIds].sort((a, b) => a - b)

  return useQuery<FitCheckResultaat[], Error>({
    queryKey: ['levertijd', 'fit-check', sortedIds, debouncedWeek],
    queryFn: () => fetchFitCheck(supabase, sortedIds, debouncedWeek!),
    enabled: sortedIds.length > 0 && !!debouncedWeek,
    staleTime: STALE_TIME_MS,
    refetchOnWindowFocus: false,
  })
}
