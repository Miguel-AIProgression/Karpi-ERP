// Hook: use-planning-berekening
// Haalt alle benodigde data op en berekent de snijplanningsvolgorde.
//
// Data-bronnen:
//   - rawStukken: zelfde werklijst-query als use-werklijst (hergebruikt via prop)
//   - IO verwacht_datum: per verwacht_inkooporder_regel_id (openstaande_inkooporder_regels)
//   - vormTarieven + moeilijkeKwaliteiten: voor snijtijd-berekening
//   - planningConfig + werktijden: voor capaciteits- en daglimieten

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePlanningConfig } from '@/hooks/use-planning-config'
import { fetchWerkagendaConfig } from '@/lib/supabase/queries/werkagenda'
import { supabase } from '@/lib/supabase/client'
import { useVormSnijtijden, useMoeilijkeKwaliteiten } from './use-snijplanning'
import type { WerklijstKwaliteitGroep } from '../lib/werklijst-groepering'
import type { WerklijstRow } from '../queries/werklijst'
import { berekenPlanning, type PlanningResultaat, type PlanningConfig } from '../lib/planning-berekening'

// ─── IO verwacht-datum query ─────────────────────────────────────────────────

async function fetchIoVerwachtDatums(ioRegelIds: number[]): Promise<Map<number, string | null>> {
  if (ioRegelIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('openstaande_inkooporder_regels')
    .select('regel_id, verwacht_datum')
    .in('regel_id', ioRegelIds)
  if (error) throw error
  return new Map(
    ((data ?? []) as Array<{ regel_id: number; verwacht_datum: string | null }>).map(
      (r) => [r.regel_id, r.verwacht_datum],
    ),
  )
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UsePlanningBerekeningResult {
  resultaat: PlanningResultaat | null
  isLoading: boolean
  error: Error | null
}

export function usePlanningBerekening(
  groepen: WerklijstKwaliteitGroep[],
  rawStukken: WerklijstRow[],
  startdatum: string,
): UsePlanningBerekeningResult {
  const { data: planningConfig, isLoading: configLoading } = usePlanningConfig()
  const { data: werktijden, isLoading: wtLoading } = useQuery({
    queryKey: ['werkagenda-config'],
    queryFn: fetchWerkagendaConfig,
  })
  const { data: vormTarieven, isLoading: vtLoading } = useVormSnijtijden()
  const { data: moeilijkeKwaliteiten, isLoading: mkLoading } = useMoeilijkeKwaliteiten()

  // Haal IO-regels op waaraan wacht-op-inkoop stukken gekoppeld zijn
  const ioRegelIds = useMemo<number[]>(() => {
    const ids = new Set<number>()
    for (const stuk of rawStukken) {
      if (stuk.verwacht_inkooporder_regel_id != null) {
        ids.add(stuk.verwacht_inkooporder_regel_id)
      }
    }
    return Array.from(ids).sort()
  }, [rawStukken])

  const { data: ioVerwachtDatums, isLoading: ioLoading, error: ioError } = useQuery({
    queryKey: ['io-verwacht-datums', ioRegelIds],
    queryFn: () => fetchIoVerwachtDatums(ioRegelIds),
    enabled: ioRegelIds.length > 0,
    staleTime: 120_000,
  })

  const effectiveIoMap = ioRegelIds.length === 0
    ? new Map<number, string | null>()
    : (ioVerwachtDatums ?? null)

  const isLoading = configLoading || wtLoading || vtLoading || mkLoading || (ioRegelIds.length > 0 && ioLoading)

  const resultaat = useMemo<PlanningResultaat | null>(() => {
    if (!planningConfig || !werktijden || !vormTarieven || !moeilijkeKwaliteiten || !effectiveIoMap) return null
    if (groepen.length === 0) return null

    const cfg: PlanningConfig = {
      wisseltijd_minuten: planningConfig.wisseltijd_minuten,
      capaciteit_per_week_streef: planningConfig.capaciteit_per_week_streef,
      capaciteit_per_week_max: planningConfig.capaciteit_per_week_max,
      max_rollen_per_dag: planningConfig.max_rollen_per_dag_streef,
    }

    return berekenPlanning(
      groepen,
      rawStukken,
      effectiveIoMap,
      startdatum,
      cfg,
      werktijden,
      vormTarieven,
      moeilijkeKwaliteiten,
    )
  }, [groepen, rawStukken, effectiveIoMap, startdatum, planningConfig, werktijden, vormTarieven, moeilijkeKwaliteiten])

  return {
    resultaat,
    isLoading,
    error: ioError as Error | null,
  }
}
