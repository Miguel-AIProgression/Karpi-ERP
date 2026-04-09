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
} from '@/lib/supabase/queries/snijplanning'
import type { SnijplanSortField, SortDirection } from '@/lib/supabase/queries/snijplanning'
import {
  createSnijplan,
  updateSnijplanStatus,
  batchUpdateSnijplanStatus,
  assignRolToSnijplan,
  approveSnijvoorstel,
} from '@/lib/supabase/queries/snijplanning-mutations'
import {
  generateSnijvoorstel,
  fetchSnijvoorstel,
  fetchGoedgekeurdVoorstel,
  fetchBeschikbareCapaciteit,
  approveSnijvoorstel as approveVoorstelOptimalisatie,
  rejectSnijvoorstel,
  voltooiSnijplanRol,
} from '@/lib/supabase/queries/snijvoorstel'

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

export function useCreateSnijplan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createSnijplan,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snijplanning'] })
      qc.invalidateQueries({ queryKey: ['productie', 'dashboard'] })
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
    mutationFn: ({ rolId, gesnedenDoor }: { rolId: number; gesnedenDoor?: string }) =>
      voltooiSnijplanRol(rolId, gesnedenDoor),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snijplanning'] })
      qc.invalidateQueries({ queryKey: ['productie', 'dashboard'] })
      qc.invalidateQueries({ queryKey: ['rollen'] })
    },
  })
}
