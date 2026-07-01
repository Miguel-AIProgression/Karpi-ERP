import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePlanningConfig } from '@/hooks/use-planning-config'
import { fetchWerkagendaConfig } from '@/lib/supabase/queries/werkagenda'
import { fetchWerklijstStukken, type WerklijstRow } from '../queries/werklijst'
import { groepeerWerklijst, type WerklijstKwaliteitGroep } from '../lib/werklijst-groepering'

function vandaagIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function useWerklijst(): {
  groepen: WerklijstKwaliteitGroep[]
  /** Ruwe stukken — direct uit de DB, zonder groepering. Nodig voor de planning-tab. */
  rawStukken: WerklijstRow[] | undefined
  isLoading: boolean
  isFetching: boolean
  error: Error | null
  ververs: () => void
} {
  const queryClient = useQueryClient()
  const { data: planningConfig, isLoading: configLoading } = usePlanningConfig()
  const { data: werktijden, isLoading: wtLoading } = useQuery({
    queryKey: ['werkagenda-config'],
    queryFn: fetchWerkagendaConfig,
  })
  const { data: stukken, isLoading: stukkenLoading, isFetching: stukkenFetching, error } = useQuery({
    queryKey: ['werklijst-stukken'],
    queryFn: fetchWerklijstStukken,
    staleTime: 60_000,
    // Automatisch ververst elke 2 minuten zolang de pagina open staat —
    // nieuwe orderregels en gewijzigde leverweek/afleverdatum worden zo
    // altijd opgepikt zonder dat de snijder zelf hoeft te verversen.
    refetchInterval: 120_000,
    refetchIntervalInBackground: false, // stopt als het tabblad niet zichtbaar is
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

  const ververs = () => queryClient.invalidateQueries({ queryKey: ['werklijst-stukken'] })

  return {
    groepen,
    rawStukken: stukken,
    isLoading,
    isFetching: stukkenFetching,
    error: error as Error | null,
    ververs,
  }
}
