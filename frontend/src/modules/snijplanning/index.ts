// Snijplanning-Module — bezit snijplan-CRUD, status-flow, snijvoorstel-pipeline,
// rol-afsluiten, auto-planning, reststuk-/aangebroken-/afval-geometrie, snij-volgorde-
// derivatie. Medium scope (ADR-0013): logica-laag (queries/hooks/lib) leeft hier.
// Runtime-components in `components/snijplanning/` en pages in `pages/snijplanning/`
// blijven fysiek en consumeren via deze barrel. Geen React-component-exports — die
// vermijden import-cycles.

// ---------------------------------------------------------------------------
// Hooks (queries)
// ---------------------------------------------------------------------------
export {
  useSnijplanningPool,
  useSnijplanningGroepen,
  useTekortAnalyse,
  useWachtOpInkoopAnalyse,
  useMaatwerkHaalbaarheid,
  useMasterPlanning,
  useSnijplannenVoorGroep,
  useSnijplanningStatusCounts,
  useSnijplanDetail,
  useStickerData,
  useStickerDataBulk,
  useRolSnijstukken,
  useBeschikbareRollen,
  useProductieDashboard,
  useSnijplanningKpis,
  useAlleSnijden,
  useRolLocaties,
  useSnijvoorstel,
  useBeschikbareCapaciteit,
  useGoedgekeurdVoorstel,
  useAutoplanningConfig,
  useConceptVoorstellen,
  useVormSnijtijden,
  useMoeilijkeKwaliteiten,
} from './hooks/use-snijplanning'

// ---------------------------------------------------------------------------
// Hooks (mutations)
// ---------------------------------------------------------------------------
export {
  useCreateSnijplan,
  useUpdateSnijplanStatus,
  useBatchUpdateSnijplanStatus,
  useAssignRol,
  useApproveSnijvoorstel,
  useGenereerSnijvoorstel,
  useKeurSnijvoorstelGoed,
  useVerwerpSnijvoorstel,
  useVoltooiSnijplanRol,
  useStartSnijdenRol,
  usePauzeerSnijdenRol,
  useUpdateAutoplanningConfig,
  useTriggerAutoplan,
  useBenodigdeLengteSchatting,
  useStartProductieRol,
  useKandidaatRollenVoorStuk,
  useWijsHandmatigToe,
  useOntgrendelHandmatig,
} from './hooks/use-snijplanning'

export type { CreateSnijplanData, ReststukResult } from './hooks/use-snijplanning'
export type { KandidaatRol } from './queries/handmatige-toewijzing'

// ---------------------------------------------------------------------------
// Cache seam (cross-Module invalidation — ADR-0013)
// ---------------------------------------------------------------------------
export { invalidateNaSnijplanMutatie } from './cache'

// ---------------------------------------------------------------------------
// Query types (voor advanced callers / parameter-shaping)
// ---------------------------------------------------------------------------
export type { SnijplanSortField, SortDirection, TekortAnalyseRow, WachtOpInkoopRow, SnijplanStatusCount, SnijGroepSummary, SnijplanningKpis, StickerData } from './queries/snijplanning'
export { formatVerzendweekShort } from './queries/snijplanning'
export type { SnijplanFormData } from './queries/snijplanning-mutations'
export type { AutoPlanningConfig, BenodigdeLengteSchatting, AutoplanGroepResultaat } from './queries/auto-planning'
export type { MaatwerkHaalbaarheidRow, InkoopRegelInfo } from './queries/haalbaarheid'
export { useSnijHaalbaarheid } from './hooks/use-snij-haalbaarheid'
export type { SnijHaalbaarheid, HaalbaarheidsRij, OrderRij } from './hooks/use-snij-haalbaarheid'
export type { MasterPlanningRow } from './queries/master-planning'
export type { ConceptVoorstelRow, VerdringingInfo, VerdrongenOrder, VerdringingWachtOpInkoopRegel } from './queries/snijvoorstel'

// ---------------------------------------------------------------------------
// Raw query-functies (alleen voor advanced callers — orchestrated saves buiten
// React Query, zoals order-form die auto-plan-trigger inline aanroept binnen
// een save-chain).
// ---------------------------------------------------------------------------
export { triggerAutoplan, fetchAutoplanningConfig } from './queries/auto-planning'

// ---------------------------------------------------------------------------
// Lib (pure helpers)
// ---------------------------------------------------------------------------
export {
  mapSnijplannenToStukken,
  groepeerStukkenPerRol,
  buildPlanFromStukken,
} from './lib/snijplan-mapping'
export type { RolGroep } from './lib/snijplan-mapping'
export { bepaalSnijtijdMinuten } from './lib/snijtijd'
export {
  computeReststukken,
  computeReststukkenEnAfval,
  computeReststukkenFromStukken,
  computeReststukkenEnAfvalFromStukken,
  computeReststukkenAngebrokenAfval,
  AANGEBROKEN_MIN_LENGTE,
  RESTSTUK_MIN_SHORT,
  RESTSTUK_MIN_LONG,
} from './lib/compute-reststukken'
export { buildSnijVolgorde } from './lib/snij-volgorde/derive'
export type { PlacementInput } from './lib/snij-volgorde/derive'
export type {
  SnijVolgorde,
  Rij,
  KnifeOperation,
  HandelingInstructie,
  ReststukMarker,
  AangebrokenMarker,
  AfvalRect,
} from './lib/snij-volgorde/types'
