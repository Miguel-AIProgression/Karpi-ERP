import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchSnijplanningPool,
  fetchSnijplanningGroepen,
  fetchSnijplannenVoorGroep,
  fetchSnijplanningStatusCounts,
  fetchSnijplanDetail,
  fetchRolSnijstukken,
  fetchBeschikbareRollen,
  fetchProductieDashboard,
  fetchConfectielijst,
} from '@/lib/supabase/queries/snijplanning'
import type { SnijplanSortField, SortDirection } from '@/lib/supabase/queries/snijplanning'
import {
  createSnijplan,
  updateSnijplanStatus,
  batchUpdateSnijplanStatus,
  assignRolToSnijplan,
  approveSnijvoorstel,
} from '@/lib/supabase/queries/snijplanning-mutations'
import type { SnijplanFormData } from '@/lib/supabase/queries/snijplanning-mutations'
import {
  generateSnijvoorstel,
  fetchSnijvoorstel,
  fetchGoedgekeurdVoorstel,
  fetchBeschikbareCapaciteit,
  approveSnijvoorstel as approveVoorstelOptimalisatie,
  rejectSnijvoorstel,
  voltooiSnijplanRol,
  type ReststukResult,
} from '@/lib/supabase/queries/snijvoorstel'
import {
  fetchAutoplanningConfig,
  updateAutoplanningConfig,
  triggerAutoplan,
  startProductieRol,
} from '@/lib/supabase/queries/auto-planning'
import type { AutoPlanningConfig } from '@/lib/supabase/queries/auto-planning'
import { berekenTotDatum } from '@/components/snijplanning/week-filter'

export function useSnijplanningPool(params: {
  status?: string
  planning_week?: number
  planning_jaar?: number
  kwaliteit_code?: string
  kleur_code?: string
  search?: string
  page?: number
  pageSize?: number
  sortBy?: SnijplanSortField
  sortDir?: SortDirection
}) {
  return useQuery({
    queryKey: ['snijplanning', params],
    queryFn: () => fetchSnijplanningPool(params),
  })
}

export function useSnijplanningGroepen(search?: string, totDatum?: string | null) {
  return useQuery({
    queryKey: ['snijplanning', 'groepen', search, totDatum],
    queryFn: () => fetchSnijplanningGroepen(search, totDatum),
  })
}

export function useSnijplannenVoorGroep(
  kwaliteitCode: string,
  kleurCode: string,
  enabled = true,
  totDatum?: string | null
) {
  return useQuery({
    queryKey: ['snijplanning', 'groep', kwaliteitCode, kleurCode, totDatum],
    queryFn: () => fetchSnijplannenVoorGroep(kwaliteitCode, kleurCode, totDatum),
    enabled,
  })
}

export function useConfectielijst() {
  return useQuery({
    queryKey: ['snijplanning', 'confectielijst'],
    queryFn: fetchConfectielijst,
  })
}

export function useSnijplanningStatusCounts(totDatum?: string | null) {
  return useQuery({
    queryKey: ['snijplanning', 'status-counts', totDatum],
    queryFn: () => fetchSnijplanningStatusCounts(totDatum),
  })
}

export function useSnijplanDetail(id: number | null) {
  return useQuery({
    queryKey: ['snijplanning', id],
    queryFn: () => fetchSnijplanDetail(id!),
    enabled: !!id,
  })
}

export function useRolSnijstukken(rolId: number | null) {
  return useQuery({
    queryKey: ['snijplanning', 'rol', rolId],
    queryFn: () => fetchRolSnijstukken(rolId!),
    enabled: !!rolId,
  })
}

export function useBeschikbareRollen(kwaliteitCode: string, kleurCode: string) {
  return useQuery({
    queryKey: ['snijplanning', 'rollen', kwaliteitCode, kleurCode],
    queryFn: () => fetchBeschikbareRollen(kwaliteitCode, kleurCode),
    enabled: !!kwaliteitCode && !!kleurCode,
  })
}

export function useProductieDashboard() {
  return useQuery({
    queryKey: ['productie', 'dashboard'],
    queryFn: fetchProductieDashboard,
  })
}

export interface CreateSnijplanData extends SnijplanFormData {
  /** Kwaliteit code voor auto-planning trigger */
  kwaliteit_code?: string
  /** Kleur code voor auto-planning trigger */
  kleur_code?: string
  /** Afleverdatum (ISO) voor auto-planning horizon check */
  afleverdatum?: string
}

export function useCreateSnijplan() {
  const qc = useQueryClient()
  const autoplan = useTriggerAutoplan()
  const { data: autoConfig } = useAutoplanningConfig()

  return useMutation({
    mutationFn: (data: CreateSnijplanData) => createSnijplan(data),
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: ['snijplanning'] })
      qc.invalidateQueries({ queryKey: ['productie', 'dashboard'] })

      // Auto-plan trigger: als auto-planning aan staat, trigger heroptimalisatie
      if (autoConfig?.enabled && variables.kwaliteit_code && variables.kleur_code) {
        const horizonDatum = berekenTotDatum(autoConfig.horizon_weken)
        // Trigger als geen afleverdatum of binnen horizon
        if (!variables.afleverdatum || !horizonDatum || variables.afleverdatum <= horizonDatum) {
          autoplan.mutate({
            kwaliteitCode: variables.kwaliteit_code,
            kleurCode: variables.kleur_code,
            totDatum: horizonDatum,
          })
        }
      }
    },
  })
}

export function useUpdateSnijplanStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: Parameters<typeof updateSnijplanStatus>[1] }) =>
      updateSnijplanStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snijplanning'] })
      qc.invalidateQueries({ queryKey: ['productie', 'dashboard'] })
    },
  })
}

export function useBatchUpdateSnijplanStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: Parameters<typeof batchUpdateSnijplanStatus>[1] }) =>
      batchUpdateSnijplanStatus(ids, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snijplanning'] })
      qc.invalidateQueries({ queryKey: ['productie', 'dashboard'] })
    },
  })
}

export function useAssignRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ snijplanId, rolId }: { snijplanId: number; rolId: number }) =>
      assignRolToSnijplan(snijplanId, rolId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snijplanning'] })
    },
  })
}

export function useApproveSnijvoorstel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (snijplanIds: number[]) => approveSnijvoorstel(snijplanIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snijplanning'] })
      qc.invalidateQueries({ queryKey: ['productie', 'dashboard'] })
    },
  })
}

export function useGenereerSnijvoorstel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kwaliteitCode, kleurCode, totDatum }: { kwaliteitCode: string; kleurCode: string; totDatum?: string | null }) =>
      generateSnijvoorstel(kwaliteitCode, kleurCode, totDatum),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snijplanning'] })
      qc.invalidateQueries({ queryKey: ['productie', 'dashboard'] })
    },
  })
}

export function useSnijvoorstel(voorstelId: number | null) {
  return useQuery({
    queryKey: ['snijvoorstel', voorstelId],
    queryFn: () => fetchSnijvoorstel(voorstelId!),
    enabled: !!voorstelId,
  })
}

export function useBeschikbareCapaciteit(kwaliteitCode: string, kleurCode: string) {
  return useQuery({
    queryKey: ['snijplanning', 'capaciteit', kwaliteitCode, kleurCode],
    queryFn: () => fetchBeschikbareCapaciteit(kwaliteitCode, kleurCode),
    staleTime: 60_000, // cache 1 min — lightweight but not needed per render
  })
}

export function useGoedgekeurdVoorstel(kwaliteitCode: string, kleurCode: string, enabled = false) {
  return useQuery({
    queryKey: ['snijvoorstel', 'goedgekeurd', kwaliteitCode, kleurCode],
    queryFn: () => fetchGoedgekeurdVoorstel(kwaliteitCode, kleurCode),
    enabled,
  })
}

export function useKeurSnijvoorstelGoed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (voorstelId: number) => approveVoorstelOptimalisatie(voorstelId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snijplanning'] })
      qc.invalidateQueries({ queryKey: ['snijvoorstel'] })
      qc.invalidateQueries({ queryKey: ['productie', 'dashboard'] })
    },
  })
}

export function useVerwerpSnijvoorstel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (voorstelId: number) => rejectSnijvoorstel(voorstelId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snijvoorstel'] })
      qc.invalidateQueries({ queryKey: ['snijplanning'] })
    },
  })
}

export function useVoltooiSnijplanRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ rolId, gesnedenDoor, overrideRestLengte }: { rolId: number; gesnedenDoor?: string; overrideRestLengte?: number | null }) =>
      voltooiSnijplanRol(rolId, gesnedenDoor, overrideRestLengte),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snijplanning'] })
      qc.invalidateQueries({ queryKey: ['productie', 'dashboard'] })
      qc.invalidateQueries({ queryKey: ['rollen'] })
    },
  })
}

export type { ReststukResult }

// ---------------------------------------------------------------------------
// Auto-planning hooks
// ---------------------------------------------------------------------------

export function useAutoplanningConfig() {
  return useQuery({
    queryKey: ['auto-planning', 'config'],
    queryFn: fetchAutoplanningConfig,
    staleTime: 5 * 60_000, // cache 5 min
  })
}

export function useUpdateAutoplanningConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: AutoPlanningConfig) => updateAutoplanningConfig(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auto-planning', 'config'] })
    },
  })
}

export function useTriggerAutoplan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kwaliteitCode, kleurCode, totDatum }: {
      kwaliteitCode: string
      kleurCode: string
      totDatum?: string | null
    }) => triggerAutoplan(kwaliteitCode, kleurCode, totDatum),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snijplanning'] })
      qc.invalidateQueries({ queryKey: ['snijvoorstel'] })
      qc.invalidateQueries({ queryKey: ['productie', 'dashboard'] })
    },
  })
}

export function useStartProductieRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rolId: number) => startProductieRol(rolId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snijplanning'] })
      qc.invalidateQueries({ queryKey: ['productie', 'dashboard'] })
    },
  })
}
