// Public surface van de planning-module.
//
// Externe consumers (router, sidebar, orders-module) importeren bij voorkeur
// via deze barrel; interne imports binnen de module mogen direct verwijzen
// naar sub-folders.

// Pages — snijplanning
export { SnijplanningOverviewPage } from './pages/snijplanning-overview'
export { RolSnijvoorstelPage } from './pages/rol-snijvoorstel'
export { SnijvoorstelReviewPage } from './pages/snijvoorstel-review'
export { StickerPrintPage } from './pages/sticker-print'
export { StickersBulkPage } from './pages/stickers-bulk'
export { ProductieRolPage } from './pages/productie-rol'
export { ProductieGroepPage } from './pages/productie-groep'

// Pages — confectie
export { ConfectieOverviewPage } from './pages/confectie-overview'
export { ConfectiePlanningPage } from './pages/confectie-planning'

// Presentatie-componenten (geconsumeerd door orders-module)
export { LevertijdBadge } from './presentatie/levertijd-badge'
export { LevertijdSuggestie } from './presentatie/levertijd-suggestie'

// Hooks — snijplanning
export {
  useSnijplanningPool,
  useSnijplanningGroepen,
  useTekortAnalyse,
  useSnijplannenVoorGroep,
  useSnijplanningStatusCounts,
  useSnijplanDetail,
  useRolSnijstukken,
  useBeschikbareRollen,
  useProductieDashboard,
  useSnijplanningKpis,
  useAlleSnijden,
  useRolLocaties,
  useCreateSnijplan,
  useUpdateSnijplanStatus,
  useBatchUpdateSnijplanStatus,
  useAssignRol,
  useApproveSnijvoorstel,
  useGenereerSnijvoorstel,
  useSnijvoorstel,
  type CreateSnijplanData,
} from './hooks/use-snijplanning'

// Hooks — confectie
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

// Hooks — planning config
export {
  usePlanningConfig,
  useUpdatePlanningConfig,
} from './hooks/use-planning-config'
