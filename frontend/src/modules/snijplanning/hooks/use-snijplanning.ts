import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchSnijplanningPool,
  fetchSnijplanningGroepen,
  fetchSnijplannenVoorGroep,
  fetchSnijplanningStatusCounts,
  fetchSnijplanDetail,
  fetchStickerData,
  fetchStickerDataBulk,
  fetchRolSnijstukken,
  fetchBeschikbareRollen,
  fetchProductieDashboard,
  fetchAlleSnijden,
  fetchRolLocaties,
  fetchTekortAnalyse,
  fetchWachtOpInkoopAnalyse,
  fetchSnijplanningKpis,
} from '../queries/snijplanning'
import type { SnijplanSortField, SortDirection, TekortAnalyseRow, WachtOpInkoopRow } from '../queries/snijplanning'
import { fetchMaatwerkHaalbaarheid, fetchInkoopRegelInfo } from '../queries/haalbaarheid'
import {
  createSnijplan,
  updateSnijplanStatus,
  batchUpdateSnijplanStatus,
  assignRolToSnijplan,
  approveSnijvoorstel,
} from '../queries/snijplanning-mutations'
import type { SnijplanFormData } from '../queries/snijplanning-mutations'
import {
  generateSnijvoorstel,
  fetchSnijvoorstel,
  fetchGoedgekeurdVoorstel,
  fetchBeschikbareCapaciteit,
  approveSnijvoorstel as approveVoorstelOptimalisatie,
  rejectSnijvoorstel,
  voltooiSnijplanRol,
  startSnijdenRol,
  pauzeerSnijdenRol,
  type ReststukResult,
} from '../queries/snijvoorstel'
import {
  fetchAutoplanningConfig,
  updateAutoplanningConfig,
  triggerAutoplan,
  fetchBenodigdeLengteSchatting,
  startProductieRol,
} from '../queries/auto-planning'
import type { AutoPlanningConfig } from '../queries/auto-planning'
import {
  fetchKandidaatRollenVoorStuk,
  wijsHandmatigToe,
  ontgrendelHandmatigeToewijzing,
} from '../queries/handmatige-toewijzing'
import { berekenTotDatum } from '@/components/snijplanning/week-filter'
import { fetchPlanningConfig } from '@/lib/supabase/queries/planning-config'
import { invalidateNaSnijplanMutatie } from '../cache'
import { invalidateNaConfectieMutatie } from '@/modules/confectie'

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

export function useTekortAnalyse() {
  return useQuery({
    queryKey: ['snijplanning', 'tekort-analyse'],
    queryFn: fetchTekortAnalyse,
    select: (rows): Map<string, TekortAnalyseRow> => {
      const m = new Map<string, TekortAnalyseRow>()
      for (const r of rows) {
        const kleurNormalised = r.kleur_code.replace(/\.0$/, '')
        m.set(`${r.kwaliteit_code}_${kleurNormalised}`, r)
      }
      return m
    },
  })
}

/** "Wacht op inkoop"-claims (mig 437/438/440) — groepeert per (kwaliteit,
 *  kleur) zodat de pagina per groep de gekoppelde inkooporder_regel(s) toont. */
export function useWachtOpInkoopAnalyse() {
  return useQuery({
    queryKey: ['snijplanning', 'wacht-op-inkoop-analyse'],
    queryFn: fetchWachtOpInkoopAnalyse,
    select: (rows): Map<string, WachtOpInkoopRow[]> => {
      const m = new Map<string, WachtOpInkoopRow[]>()
      for (const r of rows) {
        const kleurNormalised = r.kleur_code.replace(/\.0$/, '')
        const key = `${r.kwaliteit_code}_${kleurNormalised}`
        const lijst = m.get(key) ?? []
        lijst.push(r)
        m.set(key, lijst)
      }
      return m
    },
  })
}

/** Fase 1 (2026-06-19): haalbaarheid-overzicht. Haalt de stukken op + (voor
 *  status='Wacht op inkoop') de gekoppelde inkooporder-info erbij. */
export function useMaatwerkHaalbaarheid() {
  return useQuery({
    queryKey: ['snijplanning', 'maatwerk-haalbaarheid'],
    queryFn: async () => {
      const rows = await fetchMaatwerkHaalbaarheid()
      const regelIds = rows
        .map((r) => r.verwacht_inkooporder_regel_id)
        .filter((id): id is number => id != null)
      const inkoopInfo = await fetchInkoopRegelInfo(regelIds)
      return { rows, inkoopInfo }
    },
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

/** Sticker-data per snijplan voor klant-facing maatwerk-sticker (mig 295). */
export function useStickerData(id: number | null) {
  return useQuery({
    queryKey: ['snijplanning', 'sticker', id],
    queryFn: () => fetchStickerData(id!),
    enabled: !!id,
  })
}

/** Bulk-variant — 1 query voor N stickers. Sorted ids in queryKey voor cache-stabiliteit. */
export function useStickerDataBulk(ids: number[]) {
  const sorted = [...ids].sort((a, b) => a - b)
  return useQuery({
    queryKey: ['snijplanning', 'sticker', 'bulk', sorted],
    queryFn: () => fetchStickerDataBulk(sorted),
    enabled: sorted.length > 0,
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

export function useSnijplanningKpis(totDatum?: string | null) {
  return useQuery({
    queryKey: ['snijplanning', 'kpis', totDatum ?? null],
    queryFn: () => fetchSnijplanningKpis(totDatum),
  })
}

export function useAlleSnijden(totDatum?: string | null) {
  return useQuery({
    queryKey: ['snijplanning', 'alle-snijden', totDatum ?? null],
    queryFn: () => fetchAlleSnijden(totDatum),
  })
}

export function useRolLocaties(rolIds: number[]) {
  const sorted = [...rolIds].sort((a, b) => a - b).join(',')
  return useQuery({
    queryKey: ['rollen', 'locaties', sorted],
    queryFn: () => fetchRolLocaties(rolIds),
    enabled: rolIds.length > 0,
    staleTime: 60_000,
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
    onSuccess: async (_result, variables) => {
      invalidateNaSnijplanMutatie(qc)
      invalidateNaConfectieMutatie(qc)

      // Auto-plan trigger: als auto-planning aan staat, trigger heroptimalisatie.
      // De horizon komt uit planningConfig.weken_vooruit (single source of truth).
      if (autoConfig?.enabled && variables.kwaliteit_code && variables.kleur_code) {
        const planning = await qc.ensureQueryData({
          queryKey: ['planning-config'],
          queryFn: fetchPlanningConfig,
        })
        const horizonDatum = berekenTotDatum(planning.weken_vooruit ?? null)
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
      invalidateNaSnijplanMutatie(qc)
      invalidateNaConfectieMutatie(qc)
    },
  })
}

export function useBatchUpdateSnijplanStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: Parameters<typeof batchUpdateSnijplanStatus>[1] }) =>
      batchUpdateSnijplanStatus(ids, status),
    onSuccess: () => {
      invalidateNaSnijplanMutatie(qc)
      invalidateNaConfectieMutatie(qc)
    },
  })
}

export function useAssignRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ snijplanId, rolId }: { snijplanId: number; rolId: number }) =>
      assignRolToSnijplan(snijplanId, rolId),
    onSuccess: () => {
      invalidateNaSnijplanMutatie(qc)
    },
  })
}

export function useApproveSnijvoorstel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (snijplanIds: number[]) => approveSnijvoorstel(snijplanIds),
    onSuccess: () => {
      invalidateNaSnijplanMutatie(qc)
    },
  })
}

export function useGenereerSnijvoorstel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kwaliteitCode, kleurCode, totDatum }: { kwaliteitCode: string; kleurCode: string; totDatum?: string | null }) =>
      generateSnijvoorstel(kwaliteitCode, kleurCode, totDatum),
    onSuccess: () => {
      invalidateNaSnijplanMutatie(qc)
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
      invalidateNaSnijplanMutatie(qc)
    },
  })
}

export function useVerwerpSnijvoorstel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (voorstelId: number) => rejectSnijvoorstel(voorstelId),
    onSuccess: () => {
      invalidateNaSnijplanMutatie(qc)
    },
  })
}

/**
 * Sluit een rol af: zet `snijplannen.status='Gesneden'` voor gekozen stukken,
 * maakt reststuk-rollen, kort optioneel de originele rol in (aangebroken),
 * rekent grondstofkosten toe. Roept de SQL-RPC `voltooi_snijplan_rol` aan.
 *
 * **Cross-Module invalidatie:** Confectie-views (`confectie_planning_forward`)
 * lezen `snijplannen.status` direct; zonder `invalidateNaConfectieMutatie` blijven
 * stukken na "Rol afsluiten" stale onder "Klaar voor confectie" tot staleTime
 * verstrijkt. ADR-0013 (mig 246-tijdvak hotfix).
 */
export function useVoltooiSnijplanRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ rolId, gesnedenDoor, overrideRestLengte, reststukken, snijplanIds, aangebrokenLengte }: { rolId: number; gesnedenDoor?: string; overrideRestLengte?: number | null; reststukken?: import('@/lib/types/productie').ReststukRect[]; snijplanIds?: number[]; aangebrokenLengte?: number | null }) =>
      voltooiSnijplanRol(rolId, gesnedenDoor, overrideRestLengte, reststukken, snijplanIds, aangebrokenLengte),
    onSuccess: () => {
      invalidateNaSnijplanMutatie(qc)
      invalidateNaConfectieMutatie(qc)
    },
  })
}

export function useStartSnijdenRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ rolId, gebruiker }: { rolId: number; gebruiker?: string | null }) =>
      startSnijdenRol(rolId, gebruiker),
    onSuccess: () => {
      invalidateNaSnijplanMutatie(qc)
    },
  })
}

export function usePauzeerSnijdenRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ rolId }: { rolId: number }) => pauzeerSnijdenRol(rolId),
    onSuccess: () => {
      invalidateNaSnijplanMutatie(qc)
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
      invalidateNaSnijplanMutatie(qc)
    },
  })
}

/** Puur lezende schatting (geen invalidatie nodig — wijzigt niets). */
export function useBenodigdeLengteSchatting() {
  return useMutation({
    mutationFn: ({ kwaliteitCode, kleurCode }: { kwaliteitCode: string; kleurCode: string }) =>
      fetchBenodigdeLengteSchatting(kwaliteitCode, kleurCode),
  })
}

export function useStartProductieRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rolId: number) => startProductieRol(rolId),
    onSuccess: () => {
      invalidateNaSnijplanMutatie(qc)
    },
  })
}

/** Kandidaat-rollen voor de handmatige-toewijzing-dropdown (Fase 4). */
export function useKandidaatRollenVoorStuk(snijplanId: number | null) {
  return useQuery({
    queryKey: ['snijplanning', 'kandidaat-rollen', snijplanId],
    queryFn: () => fetchKandidaatRollenVoorStuk(snijplanId!),
    enabled: snijplanId != null,
  })
}

/**
 * Fase 4: wijst een stuk handmatig toe aan een rol en vergrendelt het. Triggert
 * daarna `auto-plan-groep` voor de rest van de (kwaliteit,kleur)-groep — zowel om
 * de overige stukken om het nieuwe obstakel te herverdelen als om (bij een stuk
 * dat van "Wacht op inkoop" afkomt) de IO-claim-aggregaat correct te hertellen.
 * Niet-blokkerend: een mislukte trigger laat de toewijzing zelf onaangetast.
 */
export function useWijsHandmatigToe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ snijplanId, rolId }: { snijplanId: number; rolId: number }) =>
      wijsHandmatigToe(snijplanId, rolId),
    onSuccess: async (result) => {
      invalidateNaSnijplanMutatie(qc)
      if (result.success && result.kwaliteit_code && result.kleur_code) {
        try {
          await triggerAutoplan(result.kwaliteit_code, result.kleur_code)
          invalidateNaSnijplanMutatie(qc)
        } catch (e) {
          console.warn('Auto-plan trigger na handmatige toewijzing faalde (niet-blokkerend):', e)
        }
      }
    },
  })
}

/** Fase 4: ontgrendelt een handmatig vergrendeld stuk en triggert direct een
 *  nieuwe auto-plan-groep-run voor die groep (zelfde patroon als ExpressToggle). */
export function useOntgrendelHandmatig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (snijplanId: number) => ontgrendelHandmatigeToewijzing(snijplanId),
    onSuccess: async (result) => {
      invalidateNaSnijplanMutatie(qc)
      try {
        await triggerAutoplan(result.kwaliteit_code, result.kleur_code)
        invalidateNaSnijplanMutatie(qc)
      } catch (e) {
        console.warn('Auto-plan trigger na ontgrendelen faalde (niet-blokkerend):', e)
      }
    },
  })
}
