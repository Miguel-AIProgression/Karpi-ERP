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
  useStartProductieRol,
} from './hooks/use-snijplanning'

export type { CreateSnijplanData, ReststukResult } from './hooks/use-snijplanning'

// ---------------------------------------------------------------------------
// Cache seam (cross-Module invalidation — ADR-0013)
// ---------------------------------------------------------------------------
export { invalidateNaSnijplanMutatie } from './cache'

// ---------------------------------------------------------------------------
// Query types (voor advanced callers / parameter-shaping)
// ---------------------------------------------------------------------------
export type { SnijplanSortField, SortDirection, TekortAnalyseRow, SnijplanStatusCount, SnijGroepSummary, SnijplanningKpis, StickerData } from './queries/snijplanning'
export type { SnijplanFormData } from './queries/snijplanning-mutations'
export type { AutoPlanningConfig } from './queries/auto-planning'

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
