// Confectie-Module — bezit confectie-lane-flow, capaciteit-math, deadline-formule en
// wekelijkse-planning forward-view. Smal scope: alleen logica-laag (lib + queries +
// hooks). Componenten en pages blijven in `components/confectie/` en `pages/confectie/`.
// Slot-pattern: niet-Module-componenten consumeren via deze barrel; de Module
// re-exporteert geen React-componenten om import-cycles te vermijden.

// Hooks (lijst + detail + mutations)
export {
  useConfectieOrders,
  useConfectieStatusCounts,
  useConfectieDetail,
  useConfectieByScancode,
  useUpdateConfectieStatus,
  useScanConfectieStart,
  useScanConfectieGereed,
} from './hooks/use-confectie'
export {
  useConfectiePlanning,
  useConfectieWerktijden,
  useAfrondConfectie,
  useUpdateConfectieWerktijd,
  useConfectiePlanningForward,
} from './hooks/use-confectie-planning'

// Queries (functies — meestal niet rechtstreeks gebruikt; geëxporteerd voor advanced callers)
export {
  fetchConfectieOrders,
  fetchConfectieStatusCounts,
  fetchConfectieDetail,
  fetchConfectieByScancode,
} from './queries/confectie'
export type { ConfectieSortField, SortDirection, ConfectieStatusCount } from './queries/confectie'

export {
  fetchConfectiePlanning,
  fetchConfectieWerktijden,
  fetchConfectiePlanningForward,
  afrondConfectie,
  startConfectie,
  updateConfectieWerktijd,
} from './queries/confectie-planning'
export type {
  ConfectiePlanningRow,
  ConfectieWerktijd,
  ConfectiePlanningForwardRow,
  AfrondConfectieInput,
} from './queries/confectie-planning'

// Lib (pure helpers)
export { confectieDeadline } from './lib/deadline'
export {
  isoWeekKey,
  groepeerPerLaneEnWeek,
  bezettingPerWeek,
} from './lib/forward-planner'
export type { Bezetting, LaneWerktijd } from './lib/forward-planner'
