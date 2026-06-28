import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePlanningConfig } from '@/hooks/use-planning-config'
import { fetchWerkagendaConfig } from '@/lib/supabase/queries/werkagenda'
import { fetchWerklijstStukken } from '../queries/werklijst'
import { groepeerWerklijst, type WerklijstKwaliteitGroep } from '../lib/werklijst-groepering'

function vandaagIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function useWerklijst(): {
  groepen: WerklijstKwaliteitGroep[]
  isLoading: boolean
  error: Error | null
} {
  const { data: planningConfig, isLoading: configLoading } = usePlanningConfig()
  const { data: werktijden, isLoading: wtLoading } = useQuery({
    queryKey: ['werkagenda-config'],
    queryFn: fetchWerkagendaConfig,
  })
  const { data: stukken, isLoading: stukkenLoading, error } = useQuery({
    queryKey: ['werklijst-stukken'],
    queryFn: fetchWerklijstStukken,
    staleTime: 60_000, // 1 minuut — werklijst hoeft niet realtime te zijn
  })

  const isLoading = configLoading || wtLoading || stukkenLoading

  const groepen = useMemo<WerklijstKwaliteitGroep[]>(() => {
    if (!stukken || !planningConfig || !werktijden) return []
    return groepeerWerklijst({
      stukken,
      vandaag: vandaagIso(),
      werktijden,
      snijDeadlineConfig: {
        logistieke_buffer_dagen: planningConfig.logistieke_buffer_dagen,
        dag_order_snij_buffer_werkdagen: planningConfig.dag_order_snij_buffer_werkdagen,
      },
    })
  }, [stukken, planningConfig, werktijden])

  return {
    groepen,
    isLoading,
    error: error as Error | null,
  }
}
